use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

const MAX_LINES_PER_JOB: usize = 500;

struct JobLog {
    lines: VecDeque<String>,
    next_index: usize,
    first_index: usize,
}

impl JobLog {
    fn new() -> Self {
        Self {
            lines: VecDeque::new(),
            next_index: 0,
            first_index: 0,
        }
    }
}

pub struct LogBuffer {
    inner: Mutex<HashMap<String, JobLog>>,
}

impl Default for LogBuffer {
    fn default() -> Self {
        Self::new()
    }
}

impl LogBuffer {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// Append a log line for a job. Ring buffer keeps the last MAX_LINES_PER_JOB lines.
    pub fn push_line(&self, job_id: &str, line: String) {
        let mut map = self.inner.lock().unwrap();
        let log = map.entry(job_id.to_string()).or_insert_with(JobLog::new);
        log.lines.push_back(line);
        log.next_index += 1;
        if log.lines.len() > MAX_LINES_PER_JOB {
            log.lines.pop_front();
            log.first_index += 1;
        }
    }

    /// Get log lines with index > `after`. Returns (lines, next_index).
    /// The caller should pass `next` back as `after` on the next call.
    pub fn get_lines_after(&self, job_id: &str, after: usize) -> (Vec<String>, usize) {
        let map = self.inner.lock().unwrap();
        let log = match map.get(job_id) {
            Some(l) => l,
            None => return (Vec::new(), 0),
        };

        if after >= log.next_index {
            return (Vec::new(), log.next_index);
        }

        // Calculate how many lines to skip from the front of the deque.
        // `after` is the cursor (last index the client has seen).
        // Lines in the deque cover indices [first_index, next_index).
        let start = after.saturating_sub(log.first_index);

        let lines: Vec<String> = log.lines.iter().skip(start).cloned().collect();
        (lines, log.next_index)
    }

    /// Remove all logs for a job (call on completion/failure/cancel).
    pub fn remove(&self, job_id: &str) {
        self.inner.lock().unwrap().remove(job_id);
    }
}

#[cfg(test)]
mod tests {
    use super::LogBuffer;

    #[test]
    fn append_and_incremental_read_returns_new_lines_and_cursor() {
        let logs = LogBuffer::new();
        logs.push_line("job-1", "line-a".to_string());
        logs.push_line("job-1", "line-b".to_string());

        let (first_batch, cursor) = logs.get_lines_after("job-1", 0);
        assert_eq!(first_batch, vec!["line-a".to_string(), "line-b".to_string()]);
        assert_eq!(cursor, 2);

        let (second_batch, next_cursor) = logs.get_lines_after("job-1", cursor);
        assert!(second_batch.is_empty());
        assert_eq!(next_cursor, 2);
    }

    #[test]
    fn ring_buffer_discards_oldest_lines_when_capacity_exceeded() {
        let logs = LogBuffer::new();
        for idx in 0..520 {
            logs.push_line("job-2", format!("line-{idx}"));
        }

        let (all, cursor) = logs.get_lines_after("job-2", 0);
        assert_eq!(cursor, 520);
        assert_eq!(all.len(), 500);
        assert_eq!(all.first().map(String::as_str), Some("line-20"));
        assert_eq!(all.last().map(String::as_str), Some("line-519"));
    }

    #[test]
    fn remove_clears_job_logs() {
        let logs = LogBuffer::new();
        logs.push_line("job-3", "line".to_string());
        logs.remove("job-3");

        let (lines, cursor) = logs.get_lines_after("job-3", 0);
        assert!(lines.is_empty());
        assert_eq!(cursor, 0);
    }
}
