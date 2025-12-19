use rusqlite::{params, Connection, Result};
use std::sync::Mutex;
use serde::{Serialize, Deserialize};
use crate::models::BatchMetric;
use crate::analysis::{self, AnalysisReport};
use serde_json::Value;

pub struct Database {
    conn: Mutex<Connection>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderInfo {
    /// Folder path like "Release/Scenario". Root is "".
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderStats {
    /// Folder path like "Release/Scenario". Root is "".
    pub path: String,
    pub report_count: u64,
    pub child_folder_count: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReportSummary {
    pub id: i64,
    pub created_at: String,
    pub title: String,
    pub duration_seconds: u64,
    #[serde(default)]
    pub folder_path: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TagStat {
    pub tag: String,
    pub count: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReportDetail {
    pub id: i64,
    pub created_at: String,
    pub title: String,
    pub metrics: Vec<BatchMetric>,
    pub analysis: Option<AnalysisReport>,
    pub meta: Value,
}

impl Database {
    fn normalize_folder_path(raw: &str) -> String {
        let s = raw.trim();
        if s.is_empty() {
            return "".to_string();
        }
        s.split('/')
            .map(|p| p.trim())
            .filter(|p| !p.is_empty() && *p != ".")
            .collect::<Vec<_>>()
            .join("/")
    }

    fn set_meta_folder_path(meta: &mut Value, folder_path: &str) {
        let fp = folder_path.to_string();
        if !meta.is_object() {
            *meta = serde_json::json!({});
        }
        // meta.folder_path (compat)
        meta["folder_path"] = Value::String(fp.clone());
        // meta.collection.folder_path (canonical)
        if meta.get("collection").is_none()
            || !meta.get("collection").unwrap().is_object()
        {
            meta["collection"] = serde_json::json!({});
        }
        meta["collection"]["folder_path"] = Value::String(fp);
    }

    fn get_folder_stats_conn(conn: &Connection, path: &str) -> Result<FolderStats> {
        let p = Self::normalize_folder_path(path);
        let like_prefix = if p.is_empty() { "".to_string() } else { format!("{}/", p) };

        let report_count: u64 = if p.is_empty() {
            conn.query_row("SELECT COUNT(1) FROM reports WHERE folder_path = ''", [], |row| row.get(0))?
        } else {
            conn.query_row(
                "SELECT COUNT(1) FROM reports WHERE folder_path = ?1 OR folder_path LIKE ?2",
                params![p, format!("{}%", like_prefix)],
                |row| row.get(0),
            )?
        };

        let child_folder_count: u64 = if p.is_empty() {
            conn.query_row("SELECT COUNT(1) FROM folders WHERE path != ''", [], |row| row.get(0))?
        } else {
            conn.query_row(
                "SELECT COUNT(1) FROM folders WHERE path LIKE ?1 AND path != ?2",
                params![format!("{}%", like_prefix), p],
                |row| row.get(0),
            )?
        };

        Ok(FolderStats {
            path: p,
            report_count,
            child_folder_count,
        })
    }

    fn extract_folder_path_from_meta(meta: &Value) -> String {
        // Canonical location: meta.collection.folder_path
        // Back-compat / alternative: meta.folder_path
        let raw = meta
            .get("collection")
            .and_then(|c| c.get("folder_path"))
            .and_then(|v| v.as_str())
            .or_else(|| meta.get("folder_path").and_then(|v| v.as_str()))
            .unwrap_or("")
            .trim()
            .to_string();

        // Normalize: trim slashes, collapse repeated slashes, avoid "." segments.
        let parts = raw
            .split('/')
            .map(|p| p.trim())
            .filter(|p| !p.is_empty() && *p != ".")
            .collect::<Vec<_>>();
        parts.join("/")
    }

    fn extract_tags_from_meta(meta: &Value) -> Vec<String> {
        // We support multiple historical shapes for backward compatibility:
        // - meta.test_context.tags (current)
        // - meta.collection.test_context.tags (older UI checks this)
        // - tags as an array OR as a comma-separated string
        fn read_tags(v: &Value) -> Vec<String> {
            let mut out: Vec<String> = Vec::new();
            match v {
                Value::Array(arr) => {
                    for t in arr {
                        if let Some(s) = t.as_str() {
                            out.push(s.to_string());
                        }
                    }
                }
                Value::String(s) => {
                    out.extend(
                        s.split(',')
                            .map(|x| x.trim())
                            .filter(|x| !x.is_empty())
                            .map(|x| x.to_string()),
                    );
                }
                _ => {}
            }
            out
        }

        let mut raw: Vec<String> = Vec::new();
        if let Some(v) = meta.get("test_context").and_then(|t| t.get("tags")) {
            raw.extend(read_tags(v));
        }
        if let Some(v) = meta
            .get("collection")
            .and_then(|c| c.get("test_context"))
            .and_then(|t| t.get("tags"))
        {
            raw.extend(read_tags(v));
        }

        // Normalize + dedupe (case-insensitive), keep first-seen casing.
        let mut seen = std::collections::HashSet::<String>::new();
        let mut out: Vec<String> = Vec::new();
        for t in raw {
            let trimmed = t.trim();
            if trimmed.is_empty() {
                continue;
            }
            let key = trimmed.to_lowercase();
            if seen.insert(key) {
                out.push(trimmed.to_string());
            }
        }
        out
    }

    pub fn new(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        
        // Init tables
        // Storing metrics as a huge JSON blob for simplicity in Phase 1
        conn.execute(
            "CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                title TEXT NOT NULL,
                folder_path TEXT NOT NULL DEFAULT '',
                metrics_json TEXT NOT NULL,
                meta_json TEXT NOT NULL DEFAULT '{}'
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS folders (
                path TEXT PRIMARY KEY,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        // Backward-compatible migration for existing DBs: add meta_json if missing.
        {
            let mut stmt = conn.prepare("PRAGMA table_info(reports)")?;
            let mut rows = stmt.query([])?;
            let mut has_meta = false;
            let mut has_folder = false;
            while let Some(row) = rows.next()? {
                let name: String = row.get(1)?;
                if name == "meta_json" {
                    has_meta = true;
                }
                if name == "folder_path" {
                    has_folder = true;
                }
            }
            if !has_meta {
                conn.execute(
                    "ALTER TABLE reports ADD COLUMN meta_json TEXT NOT NULL DEFAULT '{}'",
                    [],
                )?;
            }
            if !has_folder {
                conn.execute(
                    "ALTER TABLE reports ADD COLUMN folder_path TEXT NOT NULL DEFAULT ''",
                    [],
                )?;
            }
        }

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn save_report(&self, title: &str, metrics: &Vec<BatchMetric>, meta: &Value) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let metrics_json = serde_json::to_string(metrics).unwrap(); // TODO: Handle error better
        let meta_json = serde_json::to_string(meta).unwrap_or_else(|_| "{}".to_string());
        let folder_path = Self::extract_folder_path_from_meta(meta);
        let created_at = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO reports (created_at, title, folder_path, metrics_json, meta_json) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![created_at, title, folder_path, metrics_json, meta_json],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Import a report from an external dataset package (preserve created_at/title/metrics/meta).
    pub fn import_report(&self, created_at: &str, title: &str, metrics: &Vec<BatchMetric>, meta: &Value) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let metrics_json = serde_json::to_string(metrics).unwrap();
        let meta_json = serde_json::to_string(meta).unwrap_or_else(|_| "{}".to_string());
        let folder_path = Self::extract_folder_path_from_meta(meta);

        conn.execute(
            "INSERT INTO reports (created_at, title, folder_path, metrics_json, meta_json) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![created_at, title, folder_path, metrics_json, meta_json],
        )?;

        Ok(conn.last_insert_rowid())
    }

    pub fn get_all_reports(&self) -> Result<Vec<ReportSummary>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, created_at, title, folder_path, meta_json FROM reports ORDER BY id DESC")?;
        
        let report_iter = stmt.query_map([], |row| {
            let meta_str: String = row.get(4).unwrap_or_else(|_| "{}".to_string());
            let meta: Value = serde_json::from_str(&meta_str).unwrap_or_else(|_| serde_json::json!({}));
            let duration_seconds = meta
                .get("collection")
                .and_then(|c| c.get("duration_seconds"))
                .and_then(|d| d.as_u64())
                .unwrap_or(0);
            let title_from_meta = meta
                .get("test_context")
                .and_then(|t| t.get("scenario_name"))
                .and_then(|s| s.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let tags = Self::extract_tags_from_meta(&meta);
            let title_db: String = row.get(2)?;
            let folder_db: String = row.get(3).unwrap_or_else(|_| "".to_string());
            let folder_from_meta = Self::extract_folder_path_from_meta(&meta);
            Ok(ReportSummary {
                id: row.get(0)?,
                created_at: row.get(1)?,
                title: title_from_meta.unwrap_or(title_db),
                duration_seconds,
                folder_path: if !folder_from_meta.is_empty() { folder_from_meta } else { folder_db },
                tags,
            })
        })?;

        let mut reports = Vec::new();
        for report in report_iter {
            reports.push(report?);
        }
        Ok(reports)
    }

    pub fn list_folder_paths(&self) -> Result<Vec<FolderInfo>> {
        let conn = self.conn.lock().unwrap();
        let mut out: std::collections::HashSet<String> = std::collections::HashSet::new();
        out.insert("".to_string()); // root

        // explicit folders
        {
            let mut stmt = conn.prepare("SELECT path FROM folders")?;
            let iter = stmt.query_map([], |row| Ok(row.get::<_, String>(0)?))?;
            for r in iter {
                let p = Self::normalize_folder_path(&r?);
                out.insert(p);
            }
        }

        // folders referenced by reports + prefixes
        {
            let mut stmt = conn.prepare("SELECT folder_path FROM reports")?;
            let iter = stmt.query_map([], |row| Ok(row.get::<_, String>(0).unwrap_or_else(|_| "".to_string())))?;
            for r in iter {
                let p = Self::normalize_folder_path(&r?);
                out.insert(p.clone());
                if !p.is_empty() {
                    let parts = p.split('/').collect::<Vec<_>>();
                    for i in 1..parts.len() {
                        out.insert(parts[..i].join("/"));
                    }
                }
            }
        }

        let mut v = out.into_iter().collect::<Vec<_>>();
        v.sort();
        Ok(v.into_iter().map(|path| FolderInfo { path }).collect())
    }

    pub fn create_folder(&self, parent_path: &str, name: &str) -> Result<String> {
        let conn = self.conn.lock().unwrap();
        let parent = Self::normalize_folder_path(parent_path);
        let leaf = Self::normalize_folder_path(name.trim());
        if leaf.is_empty() {
            return Ok(parent);
        }
        let full = if parent.is_empty() { leaf } else { format!("{}/{}", parent, leaf) };
        let created_at = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR IGNORE INTO folders (path, created_at) VALUES (?1, ?2)",
            params![full, created_at],
        )?;
        Ok(full)
    }

    pub fn get_folder_stats(&self, path: &str) -> Result<FolderStats> {
        let conn = self.conn.lock().unwrap();
        Self::get_folder_stats_conn(&conn, path)
    }

    fn rename_folder_prefix_tx(conn: &Connection, from_prefix: &str, to_prefix: &str) -> Result<(usize, usize)> {
        let from = Self::normalize_folder_path(from_prefix);
        let to = Self::normalize_folder_path(to_prefix);
        if from.is_empty() {
            return Ok((0, 0));
        }
        let from_like = format!("{}/", from);

        // Collect report ids to update meta_json as well.
        let mut report_ids: Vec<i64> = Vec::new();
        {
            let mut stmt = conn.prepare("SELECT id FROM reports WHERE folder_path = ?1 OR folder_path LIKE ?2")?;
            let iter = stmt.query_map(params![from, format!("{}%", from_like)], |row| Ok(row.get::<_, i64>(0)?))?;
            for r in iter { report_ids.push(r?); }
        }

        for id in &report_ids {
            let (fp, meta_str): (String, String) = conn.query_row(
                "SELECT folder_path, meta_json FROM reports WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let fp_norm = Self::normalize_folder_path(&fp);
            let suffix = if fp_norm == from {
                "".to_string()
            } else if fp_norm.starts_with(&(from.clone() + "/")) {
                fp_norm[from.len() + 1..].to_string()
            } else {
                "".to_string()
            };
            let new_fp = if to.is_empty() {
                suffix
            } else if suffix.is_empty() {
                to.clone()
            } else {
                format!("{}/{}", to, suffix)
            };
            let mut meta: Value = serde_json::from_str(&meta_str).unwrap_or_else(|_| serde_json::json!({}));
            Self::set_meta_folder_path(&mut meta, &new_fp);
            let meta_json = serde_json::to_string(&meta).unwrap_or_else(|_| "{}".to_string());
            conn.execute(
                "UPDATE reports SET folder_path = ?1, meta_json = ?2 WHERE id = ?3",
                params![new_fp, meta_json, id],
            )?;
        }

        // Move folders under prefix (including the prefix itself if it exists)
        let mut folder_paths: Vec<String> = Vec::new();
        {
            let mut stmt = conn.prepare("SELECT path FROM folders WHERE path = ?1 OR path LIKE ?2")?;
            let iter = stmt.query_map(params![from, format!("{}%", from_like)], |row| Ok(row.get::<_, String>(0)?))?;
            for r in iter { folder_paths.push(Self::normalize_folder_path(&r?)); }
        }
        for p in &folder_paths {
            conn.execute("DELETE FROM folders WHERE path = ?1", params![p])?;
        }
        let created_at = chrono::Utc::now().to_rfc3339();
        for p in &folder_paths {
            let suffix = if *p == from {
                "".to_string()
            } else if p.starts_with(&(from.clone() + "/")) {
                p[from.len() + 1..].to_string()
            } else {
                "".to_string()
            };
            let new_p = if to.is_empty() {
                suffix
            } else if suffix.is_empty() {
                to.clone()
            } else {
                format!("{}/{}", to, suffix)
            };
            if new_p.is_empty() { continue; }
            conn.execute(
                "INSERT OR IGNORE INTO folders (path, created_at) VALUES (?1, ?2)",
                params![new_p, created_at],
            )?;
        }

        Ok((report_ids.len(), folder_paths.len()))
    }

    pub fn rename_folder(&self, path: &str, new_name: &str) -> Result<String> {
        let mut conn = self.conn.lock().unwrap();
        let from = Self::normalize_folder_path(path);
        if from.is_empty() {
            return Ok(from);
        }
        let parent = from.rsplit_once('/').map(|(a, _)| a.to_string()).unwrap_or_else(|| "".to_string());
        let leaf = Self::normalize_folder_path(new_name);
        if leaf.is_empty() {
            return Ok(from);
        }
        let to = if parent.is_empty() { leaf } else { format!("{}/{}", parent, leaf) };

        let tx = conn.transaction()?;
        let _ = Self::rename_folder_prefix_tx(&tx, &from, &to)?;
        tx.execute(
            "INSERT OR IGNORE INTO folders (path, created_at) VALUES (?1, ?2)",
            params![to, chrono::Utc::now().to_rfc3339()],
        )?;
        tx.commit()?;
        Ok(to)
    }

    pub fn delete_folder(&self, path: &str, strategy: Option<&str>) -> Result<(usize, usize)> {
        let mut conn = self.conn.lock().unwrap();
        let p = Self::normalize_folder_path(path);
        if p.is_empty() {
            return Ok((0, 0));
        }
        // IMPORTANT: do not call self.get_folder_stats() here (it locks the same mutex again).
        let stats = Self::get_folder_stats_conn(&conn, &p)?;
        if stats.report_count == 0 && stats.child_folder_count == 0 {
            conn.execute("DELETE FROM folders WHERE path = ?1", params![p])?;
            return Ok((0, 0));
        }
        let strat = strategy.unwrap_or("");
        if strat.is_empty() {
            return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!(
                    "FOLDER_NOT_EMPTY reports={} folders={}",
                    stats.report_count, stats.child_folder_count
                ),
            ))));
        }
        let parent = p.rsplit_once('/').map(|(a, _)| a.to_string()).unwrap_or_else(|| "".to_string());
        let dest = match strat {
            "move_to_parent" => parent,
            "move_to_root" => "".to_string(),
            _ => "".to_string(),
        };
        let tx = conn.transaction()?;
        let (moved_reports, moved_folders) = Self::rename_folder_prefix_tx(&tx, &p, &dest)?;
        tx.execute("DELETE FROM folders WHERE path = ?1", params![p])?;
        tx.commit()?;
        Ok((moved_reports, moved_folders))
    }

    /// Return distinct tag strings seen in existing reports, with frequency counts.
    pub fn get_known_tags(&self) -> Result<Vec<TagStat>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT meta_json FROM reports")?;

        let mut counts: std::collections::HashMap<String, (String, u64)> = std::collections::HashMap::new();
        let iter = stmt.query_map([], |row| {
            let meta_str: String = row.get(0).unwrap_or_else(|_| "{}".to_string());
            Ok(meta_str)
        })?;

        for r in iter {
            let meta_str = r?;
            let meta: Value = serde_json::from_str(&meta_str).unwrap_or_else(|_| serde_json::json!({}));
            for tag in Self::extract_tags_from_meta(&meta) {
                let key = tag.trim().to_lowercase();
                if key.is_empty() {
                    continue;
                }
                let entry = counts.entry(key).or_insert_with(|| (tag.clone(), 0));
                entry.1 += 1;
            }
        }

        let mut out: Vec<TagStat> = counts
            .into_iter()
            .map(|(_, (tag, count))| TagStat { tag, count })
            .collect();
        out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.to_lowercase().cmp(&b.tag.to_lowercase())));
        Ok(out)
    }
    
    pub fn get_report_detail(&self, id: i64) -> Result<ReportDetail> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, created_at, title, metrics_json, meta_json FROM reports WHERE id = ?1")?;
        
        let report = stmt.query_row([id], |row| {
            let metrics_str: String = row.get(3)?;
            let metrics: Vec<BatchMetric> = serde_json::from_str(&metrics_str).unwrap_or_default();
            let meta_str: String = row.get(4)?;
            let meta: Value = serde_json::from_str(&meta_str).unwrap_or_else(|_| serde_json::json!({}));
            
            // On-the-fly analysis
            let analysis = analysis::analyze(&metrics);

            Ok(ReportDetail {
                id: row.get(0)?,
                created_at: row.get(1)?,
                title: row.get(2)?,
                metrics,
                analysis: Some(analysis),
                meta,
            })
        })?;

        Ok(report)
    }

    pub fn delete_report(&self, id: i64) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM reports WHERE id = ?1", params![id])
    }

    pub fn delete_reports(&self, ids: &[i64]) -> Result<usize> {
        if ids.is_empty() {
            return Ok(0);
        }
        let conn = self.conn.lock().unwrap();
        // Build `IN (?1, ?2, ...)` safely with bound params.
        let placeholders = (0..ids.len())
            .map(|i| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!("DELETE FROM reports WHERE id IN ({})", placeholders);
        let mut stmt = conn.prepare(&sql)?;
        stmt.execute(rusqlite::params_from_iter(ids.iter()))
    }

    pub fn update_report_title(&self, id: i64, title: &str) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE reports SET title = ?1 WHERE id = ?2",
            params![title, id],
        )
    }

    pub fn update_report_folder_path(&self, id: i64, folder_path: &str) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let fp = Self::normalize_folder_path(folder_path);
        let meta_str: String = conn.query_row(
            "SELECT meta_json FROM reports WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        let mut meta: Value = serde_json::from_str(&meta_str).unwrap_or_else(|_| serde_json::json!({}));
        Self::set_meta_folder_path(&mut meta, &fp);
        let meta_json = serde_json::to_string(&meta).unwrap_or_else(|_| "{}".to_string());
        conn.execute(
            "UPDATE reports SET folder_path = ?1, meta_json = ?2 WHERE id = ?3",
            params![fp, meta_json, id],
        )
    }

    pub fn update_reports_folder_path(&self, ids: &[i64], folder_path: &str) -> Result<usize> {
        if ids.is_empty() {
            return Ok(0);
        }
        let conn = self.conn.lock().unwrap();
        let fp = Self::normalize_folder_path(folder_path);
        // Update meta_json for portability.
        for id in ids {
            let meta_str: String = conn.query_row(
                "SELECT meta_json FROM reports WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )?;
            let mut meta: Value = serde_json::from_str(&meta_str).unwrap_or_else(|_| serde_json::json!({}));
            Self::set_meta_folder_path(&mut meta, &fp);
            let meta_json = serde_json::to_string(&meta).unwrap_or_else(|_| "{}".to_string());
            conn.execute(
                "UPDATE reports SET folder_path = ?1, meta_json = ?2 WHERE id = ?3",
                params![fp, meta_json, id],
            )?;
        }
        let placeholders = (0..ids.len())
            .map(|i| format!("?{}", i + 2))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!("UPDATE reports SET folder_path = ?1 WHERE id IN ({})", placeholders);
        let mut params: Vec<rusqlite::types::Value> = Vec::with_capacity(ids.len() + 1);
        params.push(rusqlite::types::Value::Text(fp.to_string()));
        for id in ids {
            params.push(rusqlite::types::Value::Integer(*id));
        }
        let mut stmt = conn.prepare(&sql)?;
        stmt.execute(rusqlite::params_from_iter(params))
    }
}

