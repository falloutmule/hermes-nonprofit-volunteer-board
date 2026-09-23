import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/connection.js";
import { buildApp } from "../src/app.js";
import { testConfig } from "./helpers.js";
import { databaseReady, inspectDatabase, snapshotDatabase, restoreDatabase, operationalLog, pruneFiles } from "../src/operations.js";

const directories: string[]=[];
function temporary(){const p=mkdtempSync(join(tmpdir(),"hermes-deployment-"));directories.push(p);return p;}
afterEach(()=>{for(const p of directories.splice(0))rmSync(p,{recursive:true,force:true});});
describe("home deployment",()=>{
 it("loads explicit config files without changing global environment",()=>{
  const p=join(temporary(),"board.env");writeFileSync(p,"PORT=9876\nDATABASE_PATH=./example.sqlite\n");
  const before=process.env.CONFIG_FILE;process.env.CONFIG_FILE=p;
  try{expect(loadConfig().port).toBe(9876);expect(loadConfig({PORT:"1234"}).port).toBe(1234);}
  finally{if(before===undefined)delete process.env.CONFIG_FILE;else process.env.CONFIG_FILE=before;}
 });
 it("rejects incomplete production settings without exposing their values",()=>{
  expect(()=>loadConfig({NODE_ENV:"production"})).toThrow("TWILIO_ACCOUNT_SID");
  expect(()=>loadConfig({PORT:"private-invalid-value"})).toThrow("Invalid configuration fields: PORT");
  const env={NODE_ENV:"production",TWILIO_ACCOUNT_SID:"AC"+"a".repeat(32),TWILIO_AUTH_TOKEN:"a".repeat(32),ADMIN_API_TOKEN:"b".repeat(64),PUBLIC_BASE_URL:"https://example.invalid",DATABASE_PATH:join(temporary(),"live.sqlite")};
  expect(loadConfig(env).nodeEnv).toBe("production");
  expect(()=>loadConfig({...env,PUBLIC_BASE_URL:"http://example.invalid"})).toThrow("HTTPS");
  expect(()=>loadConfig({...env,DATABASE_PATH:"./relative.sqlite"})).toThrow("absolute");
 });
 it("readiness fails safely when a required table is lost",async()=>{
  const db=openDatabase(":memory:");const app=await buildApp({config:testConfig(),db});
  try{expect((await app.inject('/ready')).statusCode).toBe(200);db.exec('DROP TABLE sms_events');
   const r=await app.inject('/ready');expect(r.statusCode).toBe(503);expect(r.json()).toEqual({ok:false});
   expect((await app.inject('/health')).statusCode).toBe(200);
  }finally{await app.close();db.close();}
 });
 it("backs up WAL transactions and restores consent and idempotency records",async()=>{
  const folder=temporary();const source=join(folder,"source.sqlite"),backup=join(folder,"backup.sqlite"),restored=join(folder,"restored.sqlite");
  const db=openDatabase(source);
  try {
   db.exec("INSERT INTO volunteers VALUES(1,'+13035550110',NULL,'opted_out','now','now'); INSERT INTO consent_events(id,volunteer_id,action,source,keyword,policy_version,created_at) VALUES(1,1,'opt_out','twilio_inbound','STOP','2026-08-23','now'); INSERT INTO sms_events(id,twilio_message_sid,direction,volunteer_id,classification,created_at) VALUES(1,'SMSYNTHETIC','inbound',1,'stop','now');");
   await snapshotDatabase(source,backup);
  }finally{db.close();}
  await restoreDatabase(backup,restored);expect(inspectDatabase(restored)).toEqual(inspectDatabase(source));
  const reopened=new Database(restored);
  try{expect(databaseReady(reopened)).toBe(true);expect(reopened.prepare('SELECT sms_status FROM volunteers').get()).toEqual({sms_status:'opted_out'});expect(()=>reopened.prepare("INSERT INTO sms_events(twilio_message_sid,direction,created_at) VALUES('SMSYNTHETIC','inbound','now')").run()).toThrow();}
  finally{reopened.close();}
  await expect(snapshotDatabase(source,backup)).rejects.toThrow();
  writeFileSync(join(folder,'invalid.sqlite'),'invalid');
  await expect(restoreDatabase(join(folder,'invalid.sqlite'),restored)).rejects.toThrow();
  expect(inspectDatabase(restored).volunteers).toBe(1);
 });
 it("rotates only matching old operational files",()=>{
  const p=temporary();operationalLog(p,'ready_ok');
  const old=join(p,'host-2020-01-01.log');writeFileSync(old,'old');utimesSync(old,new Date(0),new Date(0));
  const unrelated=join(p,'keep.txt');writeFileSync(unrelated,'keep');utimesSync(unrelated,new Date(0),new Date(0));
  pruneFiles(p,/^host-\d{4}-\d{2}-\d{2}\.log$/,14);
  expect(readdirSync(p)).not.toContain('host-2020-01-01.log');expect(readFileSync(unrelated,'utf8')).toBe('keep');
 });
});
