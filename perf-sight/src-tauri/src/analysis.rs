use crate::models::BatchMetric;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalysisReport {
    pub score: u8, // 0-100
    pub summary: MetricSummary,
    pub top_cpu: Vec<Contributor>,
    pub top_mem: Vec<Contributor>,
    pub insights: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MetricSummary {
    pub avg_cpu: f32,
    pub max_cpu: f32,
    pub p50_cpu: f32,
    pub p90_cpu: f32,
    pub p95_cpu: f32,
    pub p99_cpu: f32,
    pub cpu_stddev: f32,
    /// Fraction of samples where total CPU exceeded 30%.
    pub cpu_high_ratio_30: f32,
    /// Fraction of samples where total CPU exceeded 60%.
    pub cpu_high_ratio_60: f32,
    pub avg_mem_mb: f64,
    pub max_mem_mb: f64,
    pub p50_mem_mb: f64,
    pub p90_mem_mb: f64,
    pub p95_mem_mb: f64,
    pub p99_mem_mb: f64,
    pub mem_stddev_mb: f64,
    /// Fraction of samples where total memory exceeded 512 MB.
    pub mem_high_ratio_512mb: f32,
    /// Fraction of samples where total memory exceeded 1024 MB.
    pub mem_high_ratio_1024mb: f32,
    pub mem_growth_rate: f64, // MB/s
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contributor {
    pub pid: u32,
    pub avg_cpu: f32,
    pub cpu_share: f32,
    pub avg_mem_mb: f64,
    pub mem_share: f64,
}

fn percentile_f32(sorted: &[f32], p: f32) -> f32 {
    if sorted.is_empty() {
        return 0.0;
    }
    let p = p.clamp(0.0, 1.0);
    let idx = ((sorted.len() - 1) as f32 * p).round() as usize;
    *sorted.get(idx).unwrap_or(&sorted[sorted.len() - 1])
}

fn percentile_f64(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let p = p.clamp(0.0, 1.0);
    let idx = ((sorted.len() - 1) as f64 * p).round() as usize;
    *sorted.get(idx).unwrap_or(&sorted[sorted.len() - 1])
}

fn stddev_f32(values: &[f32], mean: f32) -> f32 {
    if values.len() < 2 {
        return 0.0;
    }
    let var = values
        .iter()
        .map(|v| {
            let d = *v - mean;
            d * d
        })
        .sum::<f32>()
        / (values.len() as f32);
    var.sqrt()
}

fn stddev_f64(values: &[f64], mean: f64) -> f64 {
    if values.len() < 2 {
        return 0.0;
    }
    let var = values
        .iter()
        .map(|v| {
            let d = *v - mean;
            d * d
        })
        .sum::<f64>()
        / (values.len() as f64);
    var.sqrt()
}

pub fn analyze(metrics: &[BatchMetric]) -> AnalysisReport {
    if metrics.is_empty() {
        return AnalysisReport {
            score: 0,
            summary: MetricSummary {
                avg_cpu: 0.0,
                max_cpu: 0.0,
                p50_cpu: 0.0,
                p90_cpu: 0.0,
                p95_cpu: 0.0,
                p99_cpu: 0.0,
                cpu_stddev: 0.0,
                cpu_high_ratio_30: 0.0,
                cpu_high_ratio_60: 0.0,
                avg_mem_mb: 0.0,
                max_mem_mb: 0.0,
                p50_mem_mb: 0.0,
                p90_mem_mb: 0.0,
                p95_mem_mb: 0.0,
                p99_mem_mb: 0.0,
                mem_stddev_mb: 0.0,
                mem_high_ratio_512mb: 0.0,
                mem_high_ratio_1024mb: 0.0,
                mem_growth_rate: 0.0,
            },
            top_cpu: vec![],
            top_mem: vec![],
            insights: vec!["No data collected".to_string()],
        };
    }

    // 1. Flatten data: We care about TOTAL resource usage of the test (sum of all processes)
    let mut cpu_points = Vec::new();
    let mut mem_points = Vec::new();
    let mut cpu_sum_by_pid: std::collections::HashMap<u32, f32> = std::collections::HashMap::new();
    let mut mem_sum_by_pid: std::collections::HashMap<u32, f64> = std::collections::HashMap::new();
    let mut mem_total_sum: f64 = 0.0;
    let mut cpu_total_sum: f32 = 0.0;
    
    for batch in metrics {
        let mut total_cpu = 0.0;
        let mut total_mem = 0.0;
        for (pid, m) in &batch.metrics {
            total_cpu += m.cpu_usage;
            *cpu_sum_by_pid.entry(*pid).or_insert(0.0) += m.cpu_usage;

            // Memory policy:
            // - Browser mode: prefer Chrome-aligned private memory if present.
            // - System mode: use RSS.
            // We avoid memory_footprint here to keep a stable, understandable definition.
            let mem_bytes = m.memory_private.unwrap_or(m.memory_rss) as f64;
            total_mem += mem_bytes;
            *mem_sum_by_pid.entry(*pid).or_insert(0.0) += mem_bytes;
        }
        cpu_points.push(total_cpu);
        mem_points.push(total_mem / 1024.0 / 1024.0); // MB
        cpu_total_sum += total_cpu;
        mem_total_sum += total_mem;
    }

    // 2. Stats
    let avg_cpu = cpu_points.iter().sum::<f32>() / cpu_points.len() as f32;
    let max_cpu = *cpu_points.iter().max_by(|a, b| a.partial_cmp(b).unwrap()).unwrap_or(&0.0);
    
    // CPU percentiles + stability
    let mut sorted_cpu = cpu_points.clone();
    sorted_cpu.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let p50_cpu = percentile_f32(&sorted_cpu, 0.50);
    let p90_cpu = percentile_f32(&sorted_cpu, 0.90);
    let p95_cpu = percentile_f32(&sorted_cpu, 0.95);
    let p99_cpu = percentile_f32(&sorted_cpu, 0.99);
    let cpu_stddev = stddev_f32(&cpu_points, avg_cpu);
    let cpu_high_ratio_30 = cpu_points.iter().filter(|v| **v > 30.0).count() as f32 / cpu_points.len() as f32;
    let cpu_high_ratio_60 = cpu_points.iter().filter(|v| **v > 60.0).count() as f32 / cpu_points.len() as f32;

    let avg_mem = mem_points.iter().sum::<f64>() / mem_points.len() as f64;
    let max_mem = *mem_points.iter().max_by(|a, b| a.partial_cmp(b).unwrap()).unwrap_or(&0.0);
    let mut sorted_mem = mem_points.clone();
    sorted_mem.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let p50_mem = percentile_f64(&sorted_mem, 0.50);
    let p90_mem = percentile_f64(&sorted_mem, 0.90);
    let p95_mem = percentile_f64(&sorted_mem, 0.95);
    let p99_mem = percentile_f64(&sorted_mem, 0.99);
    let mem_stddev = stddev_f64(&mem_points, avg_mem);
    let mem_high_ratio_512mb = mem_points.iter().filter(|v| **v > 512.0).count() as f32 / mem_points.len() as f32;
    let mem_high_ratio_1024mb = mem_points.iter().filter(|v| **v > 1024.0).count() as f32 / mem_points.len() as f32;

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
    if cpu_high_ratio_60 > 0.05 {
        score -= 5.0;
        insights.push(format!(
            "Sustained high CPU: {:.0}% of samples > 60%",
            cpu_high_ratio_60 * 100.0
        ));
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
    if mem_high_ratio_1024mb > 0.05 {
        score -= 5.0;
        insights.push(format!(
            "High memory usage: {:.0}% of samples > 1 GB",
            mem_high_ratio_1024mb * 100.0
        ));
    }

    if score < 0.0 { score = 0.0; }

    // 5. Top contributors
    const TOP_N: usize = 5;
    let sample_count = cpu_points.len().max(1) as f32;
    let sample_count_f64 = mem_points.len().max(1) as f64;

    let contributors: Vec<Contributor> = cpu_sum_by_pid
        .iter()
        .map(|(pid, cpu_sum)| {
            let mem_sum = mem_sum_by_pid.get(pid).cloned().unwrap_or(0.0);
            Contributor {
                pid: *pid,
                avg_cpu: *cpu_sum / sample_count,
                cpu_share: if cpu_total_sum > 0.0 { *cpu_sum / cpu_total_sum } else { 0.0 },
                avg_mem_mb: (mem_sum / 1024.0 / 1024.0) / sample_count_f64,
                mem_share: if mem_total_sum > 0.0 { mem_sum / mem_total_sum } else { 0.0 },
            }
        })
        .collect();

    let mut top_cpu = contributors.clone();
    top_cpu.sort_by(|a, b| b.avg_cpu.partial_cmp(&a.avg_cpu).unwrap_or(std::cmp::Ordering::Equal));
    top_cpu.truncate(TOP_N);

    let mut top_mem = contributors;
    top_mem.sort_by(|a, b| b.avg_mem_mb.partial_cmp(&a.avg_mem_mb).unwrap_or(std::cmp::Ordering::Equal));
    top_mem.truncate(TOP_N);

    AnalysisReport {
        score: score as u8,
        summary: MetricSummary {
            avg_cpu,
            max_cpu,
            p50_cpu,
            p90_cpu,
            p95_cpu,
            p99_cpu,
            cpu_stddev,
            cpu_high_ratio_30,
            cpu_high_ratio_60,
            avg_mem_mb: avg_mem,
            max_mem_mb: max_mem,
            p50_mem_mb: p50_mem,
            p90_mem_mb: p90_mem,
            p95_mem_mb: p95_mem,
            p99_mem_mb: p99_mem,
            mem_stddev_mb: mem_stddev,
            mem_high_ratio_512mb,
            mem_high_ratio_1024mb,
            mem_growth_rate: slope,
        },
        top_cpu,
        top_mem,
        insights,
    }
}

