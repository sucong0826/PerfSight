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
pub struct ReportSummary {
    pub id: i64,
    pub created_at: String,
    pub title: String,
    pub duration_seconds: u64,
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
    pub fn new(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        
        // Init tables
        // Storing metrics as a huge JSON blob for simplicity in Phase 1
        conn.execute(
            "CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                title TEXT NOT NULL,
                metrics_json TEXT NOT NULL,
                meta_json TEXT NOT NULL DEFAULT '{}'
            )",
            [],
        )?;

        // Backward-compatible migration for existing DBs: add meta_json if missing.
        {
            let mut stmt = conn.prepare("PRAGMA table_info(reports)")?;
            let mut rows = stmt.query([])?;
            let mut has_meta = false;
            while let Some(row) = rows.next()? {
                let name: String = row.get(1)?;
                if name == "meta_json" {
                    has_meta = true;
                    break;
                }
            }
            if !has_meta {
                conn.execute(
                    "ALTER TABLE reports ADD COLUMN meta_json TEXT NOT NULL DEFAULT '{}'",
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
        let created_at = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO reports (created_at, title, metrics_json, meta_json) VALUES (?1, ?2, ?3, ?4)",
            params![created_at, title, metrics_json, meta_json],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Import a report from an external dataset package (preserve created_at/title/metrics/meta).
    pub fn import_report(&self, created_at: &str, title: &str, metrics: &Vec<BatchMetric>, meta: &Value) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let metrics_json = serde_json::to_string(metrics).unwrap();
        let meta_json = serde_json::to_string(meta).unwrap_or_else(|_| "{}".to_string());

        conn.execute(
            "INSERT INTO reports (created_at, title, metrics_json, meta_json) VALUES (?1, ?2, ?3, ?4)",
            params![created_at, title, metrics_json, meta_json],
        )?;

        Ok(conn.last_insert_rowid())
    }

    pub fn get_all_reports(&self) -> Result<Vec<ReportSummary>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, created_at, title, meta_json FROM reports ORDER BY id DESC")?;
        
        let report_iter = stmt.query_map([], |row| {
            let meta_str: String = row.get(3).unwrap_or_else(|_| "{}".to_string());
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
            let title_db: String = row.get(2)?;
            Ok(ReportSummary {
                id: row.get(0)?,
                created_at: row.get(1)?,
                title: title_from_meta.unwrap_or(title_db),
                duration_seconds,
            })
        })?;

        let mut reports = Vec::new();
        for report in report_iter {
            reports.push(report?);
        }
        Ok(reports)
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
}

