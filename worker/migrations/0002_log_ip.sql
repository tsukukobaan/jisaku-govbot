ALTER TABLE ask_log ADD COLUMN ip_hash TEXT;
CREATE INDEX ask_log_at ON ask_log(at);
CREATE INDEX ask_log_ip ON ask_log(ip_hash, at);
