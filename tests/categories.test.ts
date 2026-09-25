import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type Database from 'better-sqlite3';
import {openDatabase} from '../src/db/connection.js';
import {VolunteerBoard} from '../src/domain/board.js';
import type {CategoryInput} from '../src/domain/categories.js';
import {buildApp} from '../src/app.js';
import {testConfig,TEST_ADMIN_TOKEN,signedInbound} from './helpers.js';
let db:Database.Database,board:VolunteerBoard,sid:number;
const phone=(n:number)=>`+1303555${String(100+n).padStart(4,'0')}`;
const sms=(body:string,person=1,messageSid=`SMCAT${++sid}`)=>board.processInbound({from:phone(person),body,messageSid});
const specs=(pantry=5):CategoryInput[]=>[{key:'PANTRY',name:'Pantry',capacity:pantry,standbyEnabled:true,sortOrder:1},{key:'SUPPLIES',name:'Harm Reduction / First Aid / Hygiene',capacity:4,standbyEnabled:true,sortOrder:2},{key:'MEAL',name:'Meal',capacity:1,standbyEnabled:true,sortOrder:3}];
const dates=['2026-09-26','2026-10-03','2026-10-10','2026-10-17'];
function events(status:'draft'|'published'='published',count=4){return dates.slice(0,count).map(date=>board.createEvent({slug:'PANTRY'+date.replaceAll('-',''),name:'Saturday Pantry',location:'302 South Ave',startsAt:date+'T21:45:00.000Z',endsAt:date+'T23:00:00.000Z',capacity:6,status,staffingEnabled:true,standbyEnabled:true,seriesId:'saturday-pantry',occurrenceDate:date,recurrenceRule:'{"frequency":"weekly"}'}));}
function setup(capacity=5){const e=events();board.configureSeriesCategories('saturday-pantry',dates[0]!,specs(capacity),'Saturday Feed');return e;}
function signup(key='PANTRY',person=1,date=1){sms('JOIN',person);sms(key,person);sms(String(date),person);return sms('YES',person);}
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));db=openDatabase(':memory:');board=new VolunteerBoard(db);sid=0;});
afterEach(()=>{db.close();vi.useRealTimers();});
describe('category defaults and snapshots',()=>{
 it('preserves occurrence identities, derives total and repeats configuration idempotently',()=>{
  const existing=events('draft');const before=board.activity().length;
  board.configureSeriesCategories('saturday-pantry',dates[0]!,specs(),'Saturday Feed');
  expect(board.listEvents().map(e=>e.id)).toEqual(existing.map(e=>e.id));expect(board.listEvents().every(e=>e.name==='Saturday Feed'&&e.capacity===10&&e.status==='draft')).toBe(true);
  const count=board.activity().length;expect(count).toBeGreaterThan(before);
  board.configureSeriesCategories('saturday-pantry',dates[0]!,specs(),'Saturday Feed');expect(board.activity()).toHaveLength(count);
  expect(board.getEvent(1)?.categories.map(c=>[c.key,c.unfilledCount,c.spotsAvailable,c.signupEligible])).toEqual([['PANTRY',5,0,false],['SUPPLIES',4,0,false],['MEAL',1,0,false]]);
  expect(()=>board.updateEvent(1,{capacity:20})).toThrow();
 });
 it('keeps overrides and applies dated defaults to future materialization',()=>{
  const e=setup();board.configureEventCategories(e[1]!.id,specs(7));
  board.configureSeriesCategories('saturday-pantry','2026-10-03',specs(8));
  expect(board.getEvent(e[0]!.id)?.categories[0]?.capacity).toBe(5);
  expect(board.getEvent(e[1]!.id)?.categories[0]?.capacity).toBe(7);
  expect(board.getEvent(e[2]!.id)?.categories[0]?.capacity).toBe(8);
  const next=board.createEvent({slug:'PANTRY20261024',name:'Saturday Feed',startsAt:'2026-10-24T21:45:00Z',endsAt:'2026-10-24T23:00:00Z',capacity:10,status:'draft',seriesId:'saturday-pantry',occurrenceDate:'2026-10-24',staffingEnabled:true,standbyEnabled:true});
  expect(next.categories[0]?.capacity).toBe(8);expect(next.capacity).toBe(13);
 });
 it('rejects reserved/global/dated keywords and legacy pending state atomically',()=>{
  events();expect(()=>board.configureSeriesCategories('saturday-pantry',dates[0]!,[{...specs()[0]!,key:'YES'}])).toThrow();
  expect(()=>board.configureSeriesCategories('saturday-pantry',dates[0]!,[{...specs()[0]!,key:'PANTRY20260926'}])).toThrow();
  db.prepare("INSERT INTO standby_openings(event_id,status,created_at,updated_at) VALUES(1,'pending',?,?)").run(new Date().toISOString(),new Date().toISOString());
  expect(()=>board.configureSeriesCategories('saturday-pantry',dates[0]!,specs())).toThrow();
  expect((db.prepare('SELECT COUNT(*) n FROM category_definitions').get() as any).n).toBe(0);
 });
 it('rejects lowering below commitments/reservations or disabling active categories',()=>{
  setup(1);signup();signup('PANTRY',2);sms('DROP',1);
  expect(board.getEvent(1)?.categories[0]?.reservedCount).toBe(1);
  expect(()=>board.configureEventCategories(1,specs(0))).toThrow();
  expect(()=>board.configureEventCategories(1,specs().filter(c=>c.key!=='PANTRY'))).toThrow();
  expect(board.getEvent(1)?.categories[0]?.capacity).toBe(1);
 });
});
describe('category SMS state machine',()=>{
 it('requires consent, pages three dates, numeric context, expiry and explicit YES',()=>{
  setup();expect(sms('PANTRY').classification).toBe('category_requires_opt_in');expect(sms('1').classification).toBe('context_missing');
  sms('JOIN');const page=sms('PANTRY');expect(page.reply).toContain('NEXT');expect(page.reply).not.toContain('Oct 17');
  expect(sms('NEXT').reply).toContain('Oct 17');expect(sms('1').classification).toBe('category_confirmation');
  expect(board.staffing(4).confirmedCount).toBe(0);vi.setSystemTime(new Date('2026-09-24T12:31:00Z'));
  expect(sms('YES').classification).toBe('offer_missing');expect(board.staffing(4).confirmedCount).toBe(0);
  sms('PANTRY');sms('1');expect(sms('YES').classification).toBe('signup_confirmed');expect(board.staffing(1).confirmedCount).toBe(1);
 });
 it('routes dated slug to categories and prevents implicit category switching',()=>{
  setup();sms('JOIN');expect(sms('PANTRY20260926').classification).toBe('category_choices');sms('2');sms('YES');
  expect(board.staffing(1).signups[0]).toMatchObject({categoryKey:'SUPPLIES'});
  sms('MEAL');expect(sms('1').classification).toBe('category_existing');expect(sms('YES').classification).toBe('offer_missing');
  expect(board.staffing(1).confirmedCount).toBe(1);
 });
 it('rechecks the last slot and requires a fresh YES for standby; SID repeats do not mutate',()=>{
  setup(1);sms('JOIN');sms('PANTRY');sms('1');sms('JOIN',2);sms('PANTRY',2);sms('1',2);
  expect(sms('YES',1,'SMLAST').classification).toBe('signup_confirmed');expect(sms('YES',1,'SMLAST').duplicate).toBe(true);
  expect(sms('YES',2).classification).toBe('category_standby_reconfirm');expect(board.staffing(1).standbyCount).toBe(0);
  expect(sms('YES',2).classification).toBe('signup_standby');expect(sms('YES',2).classification).toBe('offer_missing');
  expect(board.staffing(1)).toMatchObject({confirmedCount:1,standbyCount:1});
 });
 it('keeps category queues isolated and reserves capacity increases for existing standby',()=>{
  setup(1);signup();signup('PANTRY',2);signup('MEAL',3);signup('MEAL',4);
  const drop=sms('DROP',3);expect(drop.notifications).toHaveLength(1);expect(drop.notifications[0]?.volunteerId).toBe(4);
  const change=board.configureEventCategories(1,specs(2));expect(change.notifications).toHaveLength(1);expect(change.notifications[0]?.volunteerId).toBe(2);
  expect(board.getEvent(1)?.categories[0]).toMatchObject({confirmedCount:1,reservedCount:1,spotsAvailable:0});
  expect(signup('PANTRY',5).classification).toBe('signup_standby');expect(sms('YES',2).classification).toBe('offer_accepted');
  expect(board.getEvent(1)?.categories[0]).toMatchObject({confirmedCount:2,standbyCount:1});
 });
 it('requires a numbered action even after repeated YES and supports multiple offer choices',()=>{
  setup(1);signup();signup('PANTRY',2);sms('DROP',1);
  sms('MEAL',2);sms('2',2);expect(sms('YES',2).classification).toBe('response_ambiguous');
  expect(sms('YES',2).classification).toBe('response_ambiguous');expect(board.getEvent(1)?.categories[0]?.confirmedCount).toBe(0);
  expect(sms('2',2).classification).toBe('action_confirmation');expect(sms('YES',2).classification).toBe('offer_accepted');
  expect(board.staffing(2).confirmedCount).toBe(0);
 });
 it('labels ambiguous DROP cancellation and clears context on STOP',()=>{
  setup();signup();signup('MEAL',1,2);expect(sms('DROP').reply).toContain('CANCEL');
  expect(sms('2').classification).toBe('admin_drop');expect(board.staffing(1).confirmedCount).toBe(1);expect(board.staffing(2).confirmedCount).toBe(0);
  sms('PANTRY');sms('1');sms('STOP');expect(sms('1').classification).toBe('context_missing');
 });
 it('allows new signup after opted-out/declined standby exhausts and stops offers at event start',()=>{
  setup(1);signup();signup('PANTRY',2);sms('STOP',2);sms('DROP',1);
  expect(signup('PANTRY',3).classification).toBe('signup_confirmed');
  signup('PANTRY',4);sms('DROP',3);expect(sms('NO',4).classification).toBe('offer_declined');
  expect(signup('PANTRY',5).classification).toBe('signup_confirmed');
  signup('PANTRY',6);sms('DROP',5);vi.setSystemTime(new Date('2026-09-26T21:45:00Z'));
  expect(sms('YES',4).classification).toBe('offer_conflict');expect(board.getEvent(1)?.categories[0]?.signupEligible).toBe(false);
  sms('PANTRY',6);expect(sms('1',6).reply).toContain('Oct 3');
 });
 it('exposes safe category dimensions in audit and authenticated snapshots with no raw SMS',async()=>{
  setup();signup();const snapshot=board.projectionSnapshot();expect(snapshot.staffing[0]).toMatchObject({categoryKey:'PANTRY',categoryId:1,occurrenceCategoryId:board.getEvent(1)!.categories.find(c=>c.key==='PANTRY')!.id});
  expect(snapshot.activity.some((a:any)=>a.categoryKey==='PANTRY')).toBe(true);
  const app=await buildApp({config:testConfig(),db});const response=await app.inject({url:'/api/admin/projection/snapshot',headers:{authorization:`Bearer ${TEST_ADMIN_TOKEN}`}});
  expect(response.statusCode).toBe(200);expect(response.body).not.toContain(phone(1));expect(response.body).not.toContain('SMCAT');
  expect((await app.inject({method:'PUT',url:'/api/admin/events/1/categories',payload:{categories:specs()}})).statusCode).toBe(401);
  await app.close();
 });
 it('reopens a database with pending offers in multiple categories',()=>{
  const folder=mkdtempSync(join(tmpdir(),'category-reopen-'));const file=join(folder,'board.sqlite');
  db.close();db=openDatabase(file);board=new VolunteerBoard(db);
  try{setup(1);signup();signup('PANTRY',2);signup('MEAL',3);signup('MEAL',4);sms('DROP',1);sms('DROP',3);
   expect((db.prepare("SELECT COUNT(*) n FROM standby_offers WHERE status='pending'").get() as any).n).toBe(2);
   db.close();db=openDatabase(file);board=new VolunteerBoard(db);
   expect((db.prepare("SELECT COUNT(*) n FROM standby_offers WHERE status='pending'").get() as any).n).toBe(2);
   expect(board.getEvent(1)?.categories).toHaveLength(3);
  }finally{db.close();db=openDatabase(':memory:');board=new VolunteerBoard(db);rmSync(folder,{recursive:true,force:true});}
 });
 it('does not override unchanged siblings in a full occurrence configuration',()=>{
  setup();board.configureEventCategories(2,specs(7));
  expect(board.getEvent(2)?.categories.map(c=>[c.key,c.override])).toEqual([['PANTRY',true],['SUPPLIES',false],['MEAL',false]]);
  const next=specs(8);next[1]!.capacity=6;next[2]!.capacity=2;
  board.configureSeriesCategories('saturday-pantry','2026-10-03',next);
  expect(board.getEvent(2)?.categories.map(c=>c.capacity)).toEqual([7,6,2]);
 });
 it('does not reuse a category keyword while earlier future snapshots remain active',()=>{
  setup();const next=specs();next[0]!.active=false;next[0]!.capacity=0;
  board.configureSeriesCategories('saturday-pantry','2026-10-03',next);
  expect(()=>board.createEvent({slug:'PANTRY',name:'Wrong target',startsAt:'2026-10-10T21:00:00Z',endsAt:'2026-10-10T22:00:00Z',capacity:1,status:'draft'})).toThrow();
  sms('JOIN');expect(sms('PANTRY').reply).toContain('Sep 26');
 });
 it('a repeated YES after a chosen signup never accepts a different pending offer',()=>{
  setup(1);signup();signup('PANTRY',2);sms('DROP',1);
  sms('MEAL',2);sms('2',2);sms('YES',2);sms('1',2);expect(sms('YES',2).classification).toBe('signup_confirmed');
  expect(sms('YES',2).classification).toBe('response_ambiguous');expect(sms('YES',2).classification).toBe('response_ambiguous');
  expect(board.getEvent(1)?.categories[0]?.confirmedCount).toBe(0);
  expect(board.staffing(2).confirmedCount).toBe(1);
 });

});
