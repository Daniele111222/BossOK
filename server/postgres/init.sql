\getenv app_password BOSSOK_DB_PASSWORD
CREATE ROLE bossok LOGIN PASSWORD :'app_password';
ALTER DATABASE bossok OWNER TO bossok;
