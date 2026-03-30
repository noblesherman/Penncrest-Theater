# Database Backups

This project uses Prisma with PostgreSQL, so backups should target the Postgres database itself.

The backup workflow in this repo is isolated from the app:

- `scripts/backup-postgres.sh` reads `DATABASE_URL` from `backend/.env`
- optional backup settings live in `.backup.env`
- dumps are written to `backups/` and are ignored by git
- upload only happens if you configure `rclone`
- scheduling can run through `systemd` on Ubuntu without touching your app process  

## 1. Install the required tools on Ubuntu

```bash
sudo apt update
sudo apt install postgresql-client openssl unzip
```

Install `rclone`:

```bash
sudo -v ; curl https://rclone.org/install.sh | sudo bash
```

Verify:

```bash
pg_dump --version
rclone version
```

## 2. Create the backup config

From the project root:

```bash
cp .backup.env.example .backup.env
```

Set:

- `BACKUP_OPENSSL_PASSPHRASE`: required if encryption is on
- `BACKUP_RCLONE_REMOTE`: the name of your configured rclone remote
- `BACKUP_RCLONE_PATH`: remote folder path

Example Google Drive target:

```env
BACKUP_RCLONE_REMOTE=gdrive
BACKUP_RCLONE_PATH=PenncrestTheater/db-backups
```

## 3. Connect a cloud service with rclone

Run:

```bash
rclone config
```

Good free choices:

- Google Drive
- OneDrive
- Dropbox

Pick one remote name and use that name in `.backup.env`.

## 4. Test the backup manually

Dry-run:

```bash
npm run backup:db -- --dry-run
```

Real run:

```bash
npm run backup:db
```

To test without cloud upload:

```bash
npm run backup:db -- --skip-upload
```

## 5. Schedule it on Ubuntu with systemd

These files are included:

- `deploy/systemd/theater-db-backup.service`
- `deploy/systemd/theater-db-backup.timer`

Copy them into place:

```bash
sudo cp deploy/systemd/theater-db-backup.service /etc/systemd/system/
sudo cp deploy/systemd/theater-db-backup.timer /etc/systemd/system/
```

Then edit the service file values:

```bash
sudo nano /etc/systemd/system/theater-db-backup.service
```

Replace:

- `User=noblesherman` if your app runs as a different Linux user
- `WorkingDirectory=/home/noblesherman/Penncrest-Theater` if your repo lives somewhere else
- `Environment=PATH=...` if your `node`, `npm`, `pg_dump`, or `rclone` binaries live elsewhere

Reload and enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now theater-db-backup.timer
```

Check the timer:

```bash
systemctl status theater-db-backup.timer
systemctl list-timers theater-db-backup.timer
```

Run one backup immediately:

```bash
sudo systemctl start theater-db-backup.service
journalctl -u theater-db-backup.service -n 100 --no-pager
```

The included timer runs daily at `02:00` server time.

## 6. Fallback: cron on Ubuntu

If you do not want to use `systemd`, add a cron job under the app user:

```bash
crontab -e
```

Add:

```cron
0 2 * * * cd /home/noblesherman/Penncrest-Theater && /usr/bin/env bash -lc 'npm run backup:db' >> /var/log/theater-db-backup.log 2>&1
```

Adjust the project path and `npm` path if needed.

## Restore

The safest approach is to restore into a separate database first and verify it before overwriting production.

Included restore command:

```bash
npm run restore:db -- --file backups/postgres/<file>.dump.enc --yes-i-understand
```

Restore into a different database:

```bash
npm run restore:db -- \
  --file backups/postgres/<file>.dump.enc \
  --target-db-url "postgresql://USER:PASSWORD@HOST:5432/theater_restore" \
  --yes-i-understand
```

If the backup is encrypted, the script decrypts it automatically using `BACKUP_OPENSSL_PASSPHRASE` from `.backup.env`.

Manual decrypt only:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in backups/postgres/<file>.dump.enc \
  -out /tmp/restore.dump \
  -pass env:BACKUP_OPENSSL_PASSPHRASE
```

Manual restore into PostgreSQL:

```bash
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --dbname="$DATABASE_URL" \
  /tmp/restore.dump
```

If you need to fully clear the default schema first, use:

```bash
npm run restore:db -- \
  --file backups/postgres/<file>.dump.enc \
  --drop-public-schema \
  --yes-i-understand
```

Recommended production restore sequence:

1. Stop the app process so data does not change during restore.
2. Restore into a new database first if possible.
3. Verify orders, tickets, and shows.
4. Restore over production only after verification.
