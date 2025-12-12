use rusqlite::{params, Connection, Result};
use std::sync::Mutex;
use serde::{Serialize, Deserialize};
use crate::models::BatchMetric;
use crate::analysis::{self, AnalysisReport};

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
                metrics_json TEXT NOT NULL
            )",
            [],
        )?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn save_report(&self, title: &str, metrics: &Vec<BatchMetric>) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let metrics_json = serde_json::to_string(metrics).unwrap(); // TODO: Handle error better
        let created_at = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO reports (created_at, title, metrics_json) VALUES (?1, ?2, ?3)",
            params![created_at, title, metrics_json],
        )?;

        Ok(conn.last_insert_rowid())
    }

    pub fn get_all_reports(&self) -> Result<Vec<ReportSummary>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, created_at, title FROM reports ORDER BY id DESC")?;
        
        let report_iter = stmt.query_map([], |row| {
            Ok(ReportSummary {
                id: row.get(0)?,
                created_at: row.get(1)?,
                title: row.get(2)?,
                duration_seconds: 0, // Placeholder, usually calculated from start/end times
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
        let mut stmt = conn.prepare("SELECT id, created_at, title, metrics_json FROM reports WHERE id = ?1")?;
        
        let report = stmt.query_row([id], |row| {
            let metrics_str: String = row.get(3)?;
            let metrics: Vec<BatchMetric> = serde_json::from_str(&metrics_str).unwrap_or_default();
            
            // On-the-fly analysis
            let analysis = analysis::analyze(&metrics);

            Ok(ReportDetail {
                id: row.get(0)?,
                created_at: row.get(1)?,
                title: row.get(2)?,
                metrics,
                analysis: Some(analysis),
            })
        })?;

        Ok(report)
    }
}

