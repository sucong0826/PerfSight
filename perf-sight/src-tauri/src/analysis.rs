use crate::models::BatchMetric;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalysisReport {
    pub score: u8, // 0-100
    pub summary: MetricSummary,
    pub insights: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MetricSummary {
    pub avg_cpu: f32,
    pub max_cpu: f32,
    pub p95_cpu: f32,
    pub avg_mem_mb: f64,
    pub max_mem_mb: f64,
    pub mem_growth_rate: f64, // MB/s
}

pub fn analyze(metrics: &[BatchMetric]) -> AnalysisReport {
    if metrics.is_empty() {
        return AnalysisReport {
            score: 0,
            summary: MetricSummary { avg_cpu: 0.0, max_cpu: 0.0, p95_cpu: 0.0, avg_mem_mb: 0.0, max_mem_mb: 0.0, mem_growth_rate: 0.0 },
            insights: vec!["No data collected".to_string()],
        };
    }

    // 1. Flatten data: We care about TOTAL resource usage of the test (sum of all processes)
    let mut cpu_points = Vec::new();
    let mut mem_points = Vec::new();
    
    for batch in metrics {
        let mut total_cpu = 0.0;
        let mut total_mem = 0.0;
        for m in batch.metrics.values() {
            total_cpu += m.cpu_usage;
            total_mem += m.memory_rss as f64;
        }
        cpu_points.push(total_cpu);
        mem_points.push(total_mem / 1024.0 / 1024.0); // MB
    }

    // 2. Stats
    let avg_cpu = cpu_points.iter().sum::<f32>() / cpu_points.len() as f32;
    let max_cpu = *cpu_points.iter().max_by(|a, b| a.partial_cmp(b).unwrap()).unwrap_or(&0.0);
    
    // P95 CPU
    let mut sorted_cpu = cpu_points.clone();
    sorted_cpu.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let p95_idx = (sorted_cpu.len() as f32 * 0.95) as usize;
    let p95_cpu = sorted_cpu.get(p95_idx).cloned().unwrap_or(0.0);

    let avg_mem = mem_points.iter().sum::<f64>() / mem_points.len() as f64;
    let max_mem = *mem_points.iter().max_by(|a, b| a.partial_cmp(b).unwrap()).unwrap_or(&0.0);

    // 3. Memory Trend (Linear Regression: y = kx + b)
    // We assume equal time intervals for simplicity (1 sample = 1 unit time)
    // Ideally we should use actual timestamps, but sample index is good enough for trend detection if interval is constant.
    let n = mem_points.len() as f64;
    let sum_x: f64 = (0..mem_points.len()).map(|i| i as f64).sum();
    let sum_y: f64 = mem_points.iter().sum();
    let sum_xy: f64 = mem_points.iter().enumerate().map(|(i, &y)| i as f64 * y).sum();
    let sum_xx: f64 = (0..mem_points.len()).map(|i| (i * i) as f64).sum();
    
    let slope = if n > 1.0 {
        (n * sum_xy - sum_x * sum_y) / (n * sum_xx - sum_x * sum_x)
    } else {
        0.0
    };

    // 4. Scoring & Insights
    let mut score = 100.0;
    let mut insights = Vec::new();

    // CPU Penalties
    if (avg_cpu as f64) > 30.0 { 
        score -= ((avg_cpu as f64) - 30.0) * 0.5; 
        insights.push(format!("High average CPU usage: {:.1}%", avg_cpu));
    }
    if max_cpu > 80.0 {
        score -= 10.0;
        insights.push(format!("CPU spike detected: {:.1}%", max_cpu));
    }

    // Memory Penalties
    // slope is MB per sample. If sample interval is 1s, then MB/s.
    if slope > 0.5 { 
        score -= slope * 20.0; 
        insights.push(format!("High Memory Growth detected (+{:.2} MB/sample)", slope));
    } else if slope > 0.1 {
        score -= 5.0;
        insights.push("Slight memory growth trend detected".to_string());
    }

    if score < 0.0 { score = 0.0; }

    AnalysisReport {
        score: score as u8,
        summary: MetricSummary {
            avg_cpu, max_cpu, p95_cpu,
            avg_mem_mb: avg_mem,
            max_mem_mb: max_mem,
            mem_growth_rate: slope,
        },
        insights,
    }
}

