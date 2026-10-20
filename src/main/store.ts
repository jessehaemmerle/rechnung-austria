import fs from 'node:fs';
import path from 'node:path';
import { emptyDatabase, migrateDatabase, validateDatabase } from '../core/defaults';
import type { Database } from '../core/types';

const KEEP_BACKUPS = 60;

/**
 * Persistenz als JSON-Datei im Benutzerverzeichnis. Schreibvorgänge sind atomar
 * (temporäre Datei + rename); vor der ersten Änderung eines Tages wird ein Backup angelegt.
 */
export class Store {
  private db: Database;
  private readonly file: string;
  private readonly backupDir: string;
  private lastBackupDay = '';

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'rechnung-daten.json');
    this.backupDir = path.join(dir, 'backups');
    this.db = this.load();
  }

  get dataFile(): string {
    return this.file;
  }

  get dataDir(): string {
    return path.dirname(this.file);
  }

  private load(): Database {
    if (!fs.existsSync(this.file)) return emptyDatabase();
    const raw = fs.readFileSync(this.file, 'utf8');
    try {
      return validateDatabase(migrateDatabase(JSON.parse(raw)));
    } catch (e) {
      // Defekte Datei nicht überschreiben, sondern sichern und abbrechen
      const broken = `${this.file}.defekt-${Date.now()}`;
      fs.copyFileSync(this.file, broken);
      throw new Error(`Datendatei ist beschädigt und wurde nach ${broken} gesichert: ${(e as Error).message}`);
    }
  }

  get(): Database {
    return this.db;
  }

  /** Führt eine Änderung aus und speichert sie. Bei Fehlern bleibt der alte Zustand erhalten. */
  update<T>(fn: (db: Database) => { db: Database; result: T }): T {
    const { db, result } = fn(this.db);
    this.backupOncePerDay();
    this.write(db);
    this.db = db;
    return result;
  }

  replace(db: Database): void {
    this.backupOncePerDay(true);
    this.write(db);
    this.db = db;
  }

  private write(db: Database): void {
    const tmp = `${this.file}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, JSON.stringify(db, null, 1));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }

  private backupOncePerDay(force = false): void {
    const day = new Date().toISOString().slice(0, 10);
    if ((!force && this.lastBackupDay === day) || !fs.existsSync(this.file)) return;
    fs.mkdirSync(this.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(this.file, path.join(this.backupDir, `rechnung-daten-${stamp}.json`));
    this.lastBackupDay = day;
    const files = fs.readdirSync(this.backupDir).filter((f) => f.endsWith('.json')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) fs.unlinkSync(path.join(this.backupDir, f));
  }
}
