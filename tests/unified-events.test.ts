import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {readFileSync} from "node:fs";
import {migrateDatabase} from "../src/db/migrate.js";
import { openDatabase } from "../src/db/connection.js";
import { VolunteerBoard, type EventInput } from "../src/domain/board.js";
import { buildApp } from "../src/app.js";
import { testConfig, TEST_ADMIN_TOKEN, signedInbound } from "./helpers.js";
let db: Database.Database;
let board: VolunteerBoard;
let sid=0;
const phones=['+13035550101','+13035550102','+13035550103'];
const sms=(body:string,index=0,messageSid=`SMCOMPLETION${++sid}`)=>board.processInbound({from:phones[index]!,body,messageSid});
const input=(slug='PICKUP',extra:Partial<EventInput>={}):EventInput=>({slug,name:'Pick up socks',startsAt:'2026-09-26T21:45:00.000Z',endsAt:'2026-09-26T23:00:00.000Z',capacity:1,status:'published',staffingEnabled:true,standbyEnabled:true,completionReportRequired:true,completionStatement:'10 pairs of socks picked up',...extra});
beforeEach(()=>{db=openDatabase(':memory:');board=new VolunteerBoard(db);sid=0;});
afterEach(()=>db.close());
describe('unified events and completion',()=>{
  it('migrates existing events without changing definition or enabling completion',()=>{
    const legacy=new Database(':memory:');
    legacy.exec(readFileSync('src/db/schema.sql','utf8'));
    legacy.prepare("INSERT INTO events(slug,name,starts_at,ends_at,capacity,status,created_at,updated_at) VALUES('PANTRY','Saturday Pantry','2026-09-26T21:45:00Z','2026-09-26T23:00:00Z',6,'draft','old','old')").run();
    migrateDatabase(legacy);migrateDatabase(legacy);
    expect(new VolunteerBoard(legacy).getEvent(1)).toMatchObject({id:1,name:'Saturday Pantry',capacity:6,status:'draft',staffingEnabled:true,standbyEnabled:true,completionReportRequired:false,createdAt:'old',updatedAt:'old'});
    expect(new VolunteerBoard(legacy).activity()).toEqual([]);
    legacy.close();
  });
  it('defaults new events to no staffing/reporting and validates reporting settings',()=>{
    const definition=input('MEETING',{completionStatement:null}); delete definition.staffingEnabled; delete definition.standbyEnabled; delete definition.completionReportRequired;
    const event=board.createEvent(definition);
    expect(event).toMatchObject({staffingEnabled:false,standbyEnabled:false,completionReportRequired:false});
    sms('JOIN'); expect(sms('MEETING').classification).toBe('signup_disabled');
    expect(()=>board.createEvent(input('BAD',{staffingEnabled:false}))).toThrow();
    expect(()=>board.createEvent(input('BAD',{completionStatement:null}))).toThrow();
    expect(()=>board.createEvent(input('DONE'))).toThrow();
  });
  it('first DONE completes entire event, preserves other signups and is idempotent',()=>{
    const event=board.createEvent(input('PICKUP',{capacity:2}));
    for(let i=0;i<3;i++){sms('JOIN',i);sms('PICKUP',i);}
    expect(sms('done',0,'SMDONE').classification).toBe('done_completed');
    expect(board.getEvent(event.id)?.status).toBe('completed');
    expect(sms('DONE',0,'SMDONE').duplicate).toBe(true);
    expect(sms('DONE PICKUP',1).classification).toBe('done_already_completed');
    expect((db.prepare('SELECT COUNT(*) n FROM event_completions').get() as any).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) n FROM activity WHERE action='event_completions.insert'").get() as any).n).toBe(1);
    expect(board.staffing(event.id)).toMatchObject({confirmedCount:2,standbyCount:1,spotsAvailable:0});
    expect(sms('DROP PICKUP',0).classification).toBe('drop_not_found');
    expect(board.dropSignupById(1)).toBeNull();
  });
  it('requires an explicit assignment choice, confirmed status and consent',()=>{
    board.createEvent(input('PICKUP'));board.createEvent(input('FOOD'));
    sms('JOIN');sms('PICKUP');sms('FOOD');sms('JOIN',1);sms('PICKUP',1);
    expect(sms('DONE').reply).toContain('DONE PICKUP');
    expect(board.listEvents().every(e=>e.status==='published')).toBe(true);
    expect(sms('DONE PICKUP',1).classification).toBe('done_not_found');
    sms('STOP');expect(sms('DONE PICKUP').classification).toBe('done_requires_opt_in');
    sms('START');expect(sms('DONE FOOD').classification).toBe('done_completed');
  });
  it('does not report ordinary shifts and closes pending offers on completion',()=>{
    board.createEvent(input('PANTRY',{completionReportRequired:false,completionStatement:null}));sms('JOIN');sms('PANTRY');
    expect(sms('DONE').classification).toBe('done_not_found');
    const event=board.createEvent(input('PICKUP',{capacity:2}));
    for(let i=0;i<3;i++){sms('JOIN',i);sms('PICKUP',i);}
    expect(sms('DROP PICKUP',1).notifications).toHaveLength(1);
    const result=sms('DONE PICKUP');expect(result.notifications).toEqual([]);
    expect(board.staffing(event.id)).toMatchObject({reservedCount:0,confirmedCount:1,standbyCount:1});
    expect(sms('YES',2).classification).toBe('offer_missing');
    expect((db.prepare("SELECT COUNT(*) n FROM standby_offers WHERE status='pending'").get() as any).n).toBe(0);
  });
  it('audits with outbox atomically and rolls back all completion state on failure',()=>{
    const event=board.createEvent(input());sms('JOIN');sms('PICKUP');
    const before=board.pendingProjections().length;
    db.exec("CREATE TRIGGER fail_completion BEFORE INSERT ON event_completions BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    expect(()=>sms('DONE',0,'SMROLLBACK')).toThrow();
    expect(board.getEvent(event.id)?.status).toBe('published');
    expect(board.pendingProjections()).toHaveLength(before);
    expect(db.prepare("SELECT id FROM sms_events WHERE twilio_message_sid='SMROLLBACK'").get()).toBeUndefined();
    db.exec('DROP TRIGGER fail_completion');expect(sms('DONE',0,'SMROLLBACK').classification).toBe('done_completed');
    const pending=board.pendingProjections() as {id:number}[];
    expect(board.acknowledgeProjections(pending.map(p=>p.id))).toBe(pending.length);
    expect(board.acknowledgeProjections(pending.map(p=>p.id))).toBe(0);
    expect(board.pendingProjections()).toEqual([]);
  });
  it('preserves capacity and staffing invariants and cancellation closes offers',()=>{
    const event=board.createEvent(input());sms('JOIN');sms('PICKUP');sms('JOIN',1);sms('PICKUP',1);
    expect(()=>board.updateEvent(event.id,{staffingEnabled:false,standbyEnabled:false,completionReportRequired:false})).toThrow();
    expect(()=>board.updateEvent(event.id,{capacity:0})).toThrow();
    sms('DROP PICKUP');board.updateEvent(event.id,{status:'cancelled'});
    expect(board.staffing(event.id).reservedCount).toBe(0);
    expect(sms('YES',1).classification).toBe('offer_missing');
  });
  it('adopts draft occurrences idempotently, preserves drift and batches atomically',()=>{
    const original=board.createEvent(input('PANTRY20260926',{status:'draft',completionReportRequired:false}));
    const occurrence=input('PANTRY20260926',{status:'draft',completionReportRequired:false,seriesId:'pantry',occurrenceDate:'2026-09-26',recurrenceRule:'{"frequency":"weekly"}'});
    expect(board.materializeSeries('pantry',[occurrence])[0]?.id).toBe(original.id);
    board.updateEvent(original.id,{location:'Organizer override'});
    board.materializeSeries('pantry',[occurrence]);expect(board.listEvents()).toHaveLength(1);
    expect(board.getEvent(original.id)?.location).toBe('Organizer override');
    expect(()=>board.materializeSeries('pantry',[input('PANTRY20261003',{status:'draft',seriesId:'pantry',occurrenceDate:'2026-10-03'}),input('WRONG',{status:'published',seriesId:'pantry',occurrenceDate:'2026-10-10'})])).toThrow();
    expect(board.listEvents()).toHaveLength(1);
    expect(()=>board.updateOccurrences('pantry',[{id:original.id,patch:{name:'Changed'}},{id:999,patch:{name:'Missing'}}])).toThrow();
    expect(board.getEvent(original.id)?.name).toBe(original.name);
  });
  it('serves authenticated sanitized snapshots and rejects unauthenticated projection writes',async()=>{
    board.createEvent(input());sms('JOIN');sms('PICKUP');sms('DONE');
    const app=await buildApp({config:testConfig(),db});
    expect((await app.inject('/api/admin/projection/snapshot')).statusCode).toBe(401);
    const response=await app.inject({url:'/api/admin/projection/snapshot',headers:{authorization:`Bearer ${TEST_ADMIN_TOKEN}`}});
    expect(response.statusCode).toBe(200);expect(response.json().events[0].completion.statement).toBe('10 pairs of socks picked up');
    for(const privateValue of [...phones,'smsStatus','phone_e164','twilio_message_sid','SMCOMPLETION'])expect(response.body).not.toContain(privateValue);
    expect((await app.inject({method:'POST',url:'/api/admin/projection/ack',payload:{ids:[1]}})).statusCode).toBe(401);
    await app.close();
  });
  it('validates signed DONE through the actual route and rejects tampering',async()=>{
    board.createEvent(input());sms('JOIN');sms('PICKUP');
    const app=await buildApp({config:testConfig(),db});
    const signed=signedInbound({From:phones[0]!,To:'+19704708839',Body:'DONE',MessageSid:'SMROUTEDONE'});
    const request={method:'POST' as const,url:'/webhooks/twilio/inbound',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signed.signature},payload:signed.payload};
    expect((await app.inject({...request,payload:signed.payload.replace('DONE','DONE+OTHER')})).statusCode).toBe(403);
    const response=await app.inject(request);expect(response.statusCode).toBe(200);expect(response.body).toContain('10 pairs of socks picked up');
    expect((await app.inject(request)).body).not.toContain('<Message>');
    await app.close();
  });
  it('requires an explicit keyword after prior completion and retains completion detail on staffing',()=>{
    const a=board.createEvent(input('SOCKS'));const b=board.createEvent(input('FOOD'));
    sms('JOIN');sms('SOCKS');sms('FOOD');
    expect(sms('DONE SOCKS').classification).toBe('done_completed');
    expect(sms('DONE').classification).toBe('done_ambiguous');
    expect(board.getEvent(b.id)?.status).toBe('published');
    expect(sms('DONE SOCKS').classification).toBe('done_already_completed');
    expect(board.getEvent(b.id)?.status).toBe('published');
    expect(board.staffing(a.id).completion).toMatchObject({volunteerId:1,statement:'10 pairs of socks picked up'});
    expect(sms('DONE FOOD').classification).toBe('done_completed');
  });
  it('includes task completion instructions after a standby offer is accepted',()=>{
    board.createEvent(input('PICKUP'));for(let i=0;i<3;i++){sms('JOIN',i);sms('PICKUP',i);}
    expect(sms('DROP PICKUP').notifications).toHaveLength(1);
    expect(sms('NO',1).notifications).toHaveLength(1);
    expect(sms('YES',2).reply).toContain('DONE PICKUP');
    expect(sms('DONE PICKUP',2).classification).toBe('done_completed');
    expect(sms('YES',1).classification).toBe('offer_missing');
  });
  it('audits changed safe event fields without copying private descriptions',()=>{
    const event=board.createEvent(input('PANTRY',{location:'Old location',description:'private original'}));
    board.updateEvent(event.id,{capacity:6,location:'New location',timezone:'UTC',startsAt:'2026-09-26T22:00:00.000Z',description:'private replacement',completionStatement:'Socks delivered'});
    const row=db.prepare("SELECT result FROM activity WHERE action='events.update' ORDER BY id DESC LIMIT 1").get() as {result:string};
    const delta=JSON.parse(row.result);
    expect(delta.capacity).toEqual({before:1,after:6});
    expect(delta.location).toEqual({before:'Old location',after:'New location'});
    expect(delta.timezone).toEqual({before:'America/Denver',after:'UTC'});
    expect(delta.startsAt.after).toBe('2026-09-26T22:00:00.000Z');
    expect(delta.completionStatement.after).toBe('Socks delivered');expect(delta.descriptionChanged).toBe(true);
    expect(delta.name).toBeUndefined();expect(row.result).not.toContain('private');
  });

});
