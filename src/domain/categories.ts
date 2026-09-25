import type Database from 'better-sqlite3';
import type {Notification,ProcessResult} from './board.js';
type Reply=Omit<ProcessResult,'duplicate'>;
type Volunteer={id:number;sms_status:string};
type Action={kind:'signup'|'standby'|'offer';eventId?:number;categoryId?:number;offerId?:number};
type Context={stage:string;categoryId?:number;eventId?:number;page?:number;ids?:number[];actions?:Action[];action?:Action};
export type CategoryInput={key:string;name:string;capacity:number;standbyEnabled:boolean;active?:boolean|undefined;sortOrder?:number|undefined};
const now=()=>new Date().toISOString();
const answer=(classification:string,reply:string|null,notifications:Notification[]=[]):Reply=>({classification,reply,notifications});
const reserved=new Set(['JOIN','HELP','STOP','START','DROP','YES','NO','DONE','NEXT']);
export class CategoryService {
  constructor(private db:Database.Database){}
  categories(eventId:number) {
    const event=this.db.prepare('SELECT * FROM events WHERE id=?').get(eventId) as any;
    return (this.db.prepare(`SELECT c.*,d.keyword FROM event_categories c JOIN category_definitions d ON d.id=c.category_id WHERE c.event_id=? ORDER BY c.sort_order,c.id`).all(eventId) as any[]).map(c=>{
      const counts=this.db.prepare(`SELECT SUM(status='confirmed') confirmed,SUM(status='standby') standby FROM signups WHERE category_id=?`).get(c.id) as any;
      const reservedCount=(this.db.prepare("SELECT COUNT(*) n FROM standby_openings WHERE category_id=? AND status='pending'").get(c.id) as any).n;
      const confirmedCount=counts.confirmed??0,standbyCount=counts.standby??0,unfilledCount=Math.max(0,c.capacity-confirmedCount-reservedCount);
      const signupEligible=Boolean(c.active && event.staffing_enabled && event.status==='published' && Date.parse(event.starts_at)>Date.now() && (unfilledCount>0||c.standby_enabled));
      return {id:c.id,categoryId:c.category_id,key:c.keyword,categoryKey:c.keyword,name:c.name,capacity:c.capacity,standbyEnabled:Boolean(c.standby_enabled),active:Boolean(c.active),sortOrder:c.sort_order,override:Boolean(c.is_override),confirmedCount,standbyCount,reservedCount,unfilledCount,unfilled:unfilledCount,signupEligible,spotsAvailable:signupEligible?unfilledCount:0,signupAvailable:signupEligible?unfilledCount:0};
    });
  }
  hasCategories(eventId:number){return Boolean(this.db.prepare('SELECT id FROM event_categories WHERE event_id=? LIMIT 1').get(eventId));}
  private validate(input:CategoryInput,seriesId:string|null,eventId:number|null) {
    const key=input.key.trim().toUpperCase();
    if(!/^[A-Z][A-Z0-9_-]{1,31}$/.test(key)||reserved.has(key)||!input.name.trim()||!Number.isInteger(input.capacity)||input.capacity<0)throw new Error('Invalid category');
    if(this.db.prepare('SELECT id FROM events WHERE slug=? COLLATE NOCASE').get(key))throw new Error('Category keyword conflicts with event');
    const other=this.db.prepare('SELECT * FROM category_definitions WHERE keyword=? COLLATE NOCASE AND (series_id IS NOT ? OR event_id IS NOT ?)').get(key,seriesId,eventId) as any;
    if(other && (other.active || this.db.prepare('SELECT c.id FROM event_categories c JOIN events e ON e.id=c.event_id WHERE c.category_id=? AND c.active=1 AND julianday(e.starts_at)>julianday(?) LIMIT 1').get(other.id,now())))throw new Error('Category keyword belongs to another event');
    return key;
  }
  private saveDefinition(input:CategoryInput,seriesId:string|null,eventId:number|null) {
    const key=this.validate(input,seriesId,eventId),active=Number(input.active??true),sort=input.sortOrder??0;
    let row=this.db.prepare('SELECT * FROM category_definitions WHERE keyword=? AND series_id IS ? AND event_id IS ?').get(key,seriesId,eventId) as any;
    if(!row){const result=this.db.prepare('INSERT INTO category_definitions(series_id,event_id,keyword,name,active,sort_order) VALUES(?,?,?,?,?,?)').run(seriesId,eventId,key,input.name.trim(),active,sort);row={id:Number(result.lastInsertRowid)};}
    else if(row.name!==input.name.trim()||row.active!==active||row.sort_order!==sort)this.db.prepare('UPDATE category_definitions SET name=?,active=?,sort_order=? WHERE id=?').run(input.name.trim(),active,sort,row.id);
    return row.id as number;
  }
  private saveSnapshot(eventId:number,definitionId:number,input:CategoryInput,override:boolean,notifications:Notification[]) {
    const existing=this.db.prepare('SELECT * FROM event_categories WHERE event_id=? AND category_id=?').get(eventId,definitionId) as any;
    const active=Number(input.active??true),standby=Number(input.standbyEnabled),sort=input.sortOrder??0;
    if(existing){
      const current=this.categories(eventId).find(c=>c.id===existing.id)!;
      if(input.capacity<current.confirmedCount+current.reservedCount)throw new Error('Category capacity below commitments');
      if(!active&&(current.confirmedCount+current.standbyCount+current.reservedCount)>0)throw new Error('Resolve category commitments before disabling');
      if(!standby&&(current.standbyCount+current.reservedCount)>0)throw new Error('Resolve standby before disabling');
      if(existing.name===input.name&&existing.capacity===input.capacity&&existing.active===active&&existing.standby_enabled===standby&&existing.sort_order===sort&&existing.is_override===Number(override))return;
      this.db.prepare('UPDATE event_categories SET name=?,capacity=?,standby_enabled=?,active=?,sort_order=?,is_override=? WHERE id=?').run(input.name,input.capacity,standby,active,sort,Number(override),existing.id);
      if(input.capacity>existing.capacity)this.reserveQueuedCapacity(existing.id,notifications);
    }else this.db.prepare('INSERT INTO event_categories(event_id,category_id,name,capacity,standby_enabled,active,sort_order,is_override) VALUES(?,?,?,?,?,?,?,?)').run(eventId,definitionId,input.name,input.capacity,standby,active,sort,Number(override));
  }
  private deriveCapacity(eventId:number){const total=(this.db.prepare('SELECT COALESCE(SUM(capacity),0) n FROM event_categories WHERE event_id=? AND active=1').get(eventId) as any).n;const standby=(this.db.prepare('SELECT COALESCE(MAX(standby_enabled),0) n FROM event_categories WHERE event_id=? AND active=1').get(eventId) as any).n;this.db.prepare('UPDATE events SET capacity=?,standby_enabled=?,updated_at=? WHERE id=? AND (capacity<>? OR standby_enabled<>?)').run(total,standby,now(),eventId,total,standby);}
  applyDefaults(eventId:number,notifications:Notification[]=[]){
    const event=this.db.prepare('SELECT * FROM events WHERE id=?').get(eventId) as any;if(!event?.series_id||!event.occurrence_date)return;
    const defs=this.db.prepare('SELECT * FROM category_definitions WHERE series_id=?').all(event.series_id) as any[];
    for(const d of defs){const spec=this.db.prepare('SELECT * FROM category_defaults WHERE category_id=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1').get(d.id,event.occurrence_date) as any;if(!spec)continue;
      const existing=this.db.prepare('SELECT is_override FROM event_categories WHERE event_id=? AND category_id=?').get(eventId,d.id) as any;if(existing?.is_override)continue;
      this.saveSnapshot(eventId,d.id,{key:d.keyword,name:spec.name,capacity:spec.capacity,standbyEnabled:Boolean(spec.standby_enabled),active:Boolean(spec.active),sortOrder:spec.sort_order},false,notifications);
    }
    if(this.hasCategories(eventId))this.deriveCapacity(eventId);
  }
  configureSeries(seriesId:string,effectiveFrom:string,inputs:CategoryInput[],eventName?:string){
    return this.db.transaction(()=>{
      this.db.prepare("UPDATE operation_context SET source='admin_api' WHERE id=1").run();
      if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)||!inputs.length||new Set(inputs.map(i=>i.key.toUpperCase())).size!==inputs.length)throw new Error('Invalid category configuration');
      const events=this.db.prepare("SELECT * FROM events WHERE series_id=? AND occurrence_date>=? ORDER BY occurrence_date").all(seriesId,effectiveFrom) as any[];
      if(!events.length)throw new Error('Series not found');
      if(events.some(e=>Date.parse(e.starts_at)<=Date.now()||['cancelled','completed'].includes(e.status)))throw new Error('Historical occurrences cannot be rewritten');
      for(const e of events)if(this.db.prepare("SELECT id FROM signups WHERE event_id=? AND category_id IS NULL AND status<>'cancelled'").get(e.id)||this.db.prepare("SELECT id FROM standby_openings WHERE event_id=? AND category_id IS NULL AND status='pending'").get(e.id)||this.db.prepare("SELECT id FROM standby_offers WHERE event_id=? AND category_id IS NULL AND status='pending'").get(e.id))throw new Error('Uncategorized active signups require organizer review');
      const existing=this.db.prepare('SELECT * FROM category_definitions WHERE series_id=?').all(seriesId) as any[];
      const all=[...inputs,...existing.filter(d=>!inputs.some(i=>i.key.toUpperCase()===d.keyword)).map(d=>({key:d.keyword,name:d.name,capacity:0,standbyEnabled:false,active:false,sortOrder:d.sort_order}))];
      for(const input of all){const definition=this.saveDefinition(input,seriesId,null);const values=[input.name,input.capacity,Number(input.standbyEnabled),Number(input.active??true),input.sortOrder??0];
        const old=this.db.prepare('SELECT * FROM category_defaults WHERE category_id=? AND effective_from=?').get(definition,effectiveFrom) as any;
        if(!old)this.db.prepare('INSERT INTO category_defaults(category_id,effective_from,name,capacity,standby_enabled,active,sort_order) VALUES(?,?,?,?,?,?,?)').run(definition,effectiveFrom,...values);
        else if([old.name,old.capacity,old.standby_enabled,old.active,old.sort_order].some((v,i)=>v!==values[i]))this.db.prepare('UPDATE category_defaults SET name=?,capacity=?,standby_enabled=?,active=?,sort_order=? WHERE id=?').run(...values,old.id);
      }
      const notifications:Notification[]=[];
      for(const e of events){this.applyDefaults(e.id,notifications);if(eventName&&e.name!==eventName)this.db.prepare('UPDATE events SET name=?,updated_at=? WHERE id=?').run(eventName,now(),e.id);}
      return {eventIds:events.map(e=>e.id) as number[],notifications};
    })();
  }
  configureEvent(eventId:number,inputs:CategoryInput[]){return this.db.transaction(()=>{
    this.db.prepare("UPDATE operation_context SET source='admin_api' WHERE id=1").run();const event=this.db.prepare('SELECT * FROM events WHERE id=?').get(eventId) as any;
    if(!event||Date.parse(event.starts_at)<=Date.now()||['cancelled','completed'].includes(event.status))throw new Error('Event is not editable');
    if(!inputs.length||new Set(inputs.map(i=>i.key.toUpperCase())).size!==inputs.length)throw new Error('Invalid category configuration');
    if(this.db.prepare("SELECT id FROM signups WHERE event_id=? AND category_id IS NULL AND status<>'cancelled'").get(eventId)||this.db.prepare("SELECT id FROM standby_openings WHERE event_id=? AND category_id IS NULL AND status='pending'").get(eventId)||this.db.prepare("SELECT id FROM standby_offers WHERE event_id=? AND category_id IS NULL AND status='pending'").get(eventId))throw new Error('Uncategorized active signups require review');
    const current=this.categories(eventId),notifications:Notification[]=[];
    for(const input of inputs){let definition=this.db.prepare('SELECT id FROM category_definitions WHERE keyword=? AND series_id IS ? AND event_id IS ?').get(input.key.toUpperCase(),event.series_id,event.series_id?null:eventId) as any;
      if(!definition){if(event.series_id)throw new Error('New series category requires series configuration');definition={id:this.saveDefinition(input,null,eventId)};}
      const before=current.find(c=>c.categoryId===definition.id);
      const changed=!before||before.name!==input.name||before.capacity!==input.capacity||before.standbyEnabled!==input.standbyEnabled||before.active!==(input.active??true)||before.sortOrder!==(input.sortOrder??0);
      this.saveSnapshot(eventId,definition.id,input,Boolean(before?.override||changed),notifications);
    }
    for(const c of current)if(!inputs.some(i=>i.key.toUpperCase()===c.key))this.saveSnapshot(eventId,c.categoryId,{key:c.key,name:c.name,capacity:0,standbyEnabled:false,active:false,sortOrder:c.sortOrder},true,notifications);
    this.deriveCapacity(eventId);return {eventIds:[eventId],notifications};
  })();}
  private eligibleCategory(id:number){const c=this.db.prepare('SELECT c.*,d.keyword,e.status event_status,e.starts_at,e.name event_name,e.slug event_slug,e.timezone,e.staffing_enabled,e.completion_report_required FROM event_categories c JOIN category_definitions d ON d.id=c.category_id JOIN events e ON e.id=c.event_id WHERE c.id=?').get(id) as any;return c&&c.active&&c.staffing_enabled&&c.event_status==='published'&&Date.parse(c.starts_at)>Date.now()?c:null;}
  private context(id:number):Context|null{const c=this.db.prepare('SELECT * FROM sms_context WHERE volunteer_id=?').get(id) as any;if(!c)return null;if(Date.parse(c.expires_at)<=Date.now()){this.clear(id);return null;}return {...JSON.parse(c.context_json),stage:c.stage};}
  private save(id:number,context:Context){const {stage,...data}=context;const time=now();this.db.prepare('INSERT INTO sms_context VALUES(?,?,?,?,?) ON CONFLICT(volunteer_id) DO UPDATE SET stage=excluded.stage,context_json=excluded.context_json,updated_at=excluded.updated_at,expires_at=excluded.expires_at').run(id,stage,JSON.stringify(data),time,new Date(Date.now()+30*60000).toISOString());}
  clear(id:number){this.db.prepare('DELETE FROM sms_context WHERE volunteer_id=?').run(id);}
  private date(c:any){return new Intl.DateTimeFormat('en-US',{timeZone:c.timezone??'America/Denver',month:'short',day:'numeric',year:'numeric'}).format(new Date(c.starts_at));}
  private dates(volunteerId:number,definitionId:number,page=0):Reply{
    const rows=this.db.prepare("SELECT c.id,c.event_id,e.starts_at,e.timezone,e.name event_name,c.name FROM event_categories c JOIN events e ON e.id=c.event_id WHERE c.category_id=? AND c.active=1 AND e.staffing_enabled=1 AND e.status='published' AND julianday(e.starts_at)>julianday(?) ORDER BY e.starts_at,e.id").all(definitionId,now()) as any[];
    const selected=rows.slice(page*3,page*3+3);if(!selected.length){this.clear(volunteerId);return answer('category_no_dates','No upcoming published dates for this category.');}
    this.save(volunteerId,{stage:'dates',categoryId:definitionId,page,ids:selected.map(r=>r.id)});
    return answer('category_dates',selected.map((r,i)=>`${i+1}. ${this.date(r)} - ${r.name}`).join('\n')+'\nReply with a number.'+(rows.length>(page+1)*3?' NEXT for more dates.':''));
  }
  private choose(volunteer:Volunteer,categoryId:number):Reply{
    const c=this.eligibleCategory(categoryId);if(!c){this.clear(volunteer.id);return answer('category_unavailable','That date/category is no longer available. Text the category keyword to choose again.');}
    const prior=this.db.prepare("SELECT s.*,c.name category_name FROM signups s LEFT JOIN event_categories c ON c.id=s.category_id WHERE s.event_id=? AND s.volunteer_id=? AND s.status IN('confirmed','standby')").get(c.event_id,volunteer.id) as any;
    if(prior){this.clear(volunteer.id);return answer('category_existing',`You are already ${prior.status} for ${c.event_name}, ${this.date(c)}${prior.category_name?`, ${prior.category_name}`:''}. To change categories, cancel that signup and rejoin.`);}
    const counts=this.categories(c.event_id).find(x=>x.id===categoryId)!;
    const full=counts.unfilledCount===0;
    if(full&&!c.standby_enabled){this.clear(volunteer.id);return answer('category_full','This category is full and has no standby list.');}
    this.save(volunteer.id,{stage:full?'standby':'signup',categoryId,eventId:c.event_id});
    return answer('category_confirmation',`${c.event_name}, ${this.date(c)} - ${c.name}. ${full?'Full. Reply YES to join standby.':'Reply YES to confirm your signup.'} Reply NO to cancel this request.`);
  }
  private commitSignup(volunteer:Volunteer,ctx:Context):Reply{
    const c=this.eligibleCategory(ctx.categoryId!);if(!c){this.clear(volunteer.id);return answer('category_unavailable','That date/category is no longer available.');}
    if(volunteer.sms_status!=='opted_in'){this.clear(volunteer.id);return answer('category_requires_opt_in','Reply JOIN before signing up.');}
    if(this.db.prepare("SELECT id FROM signups WHERE event_id=? AND volunteer_id=? AND status IN('confirmed','standby')").get(c.event_id,volunteer.id))return this.choose(volunteer,ctx.categoryId!);
    const notifications:Notification[]=[];this.advance(c.id,notifications);
    const counts=this.categories(c.event_id).find(x=>x.id===c.id)!;
    const full=counts.unfilledCount===0;
    if(full&&ctx.stage==='signup'){
      if(!c.standby_enabled){this.clear(volunteer.id);return answer('category_full','That place was filled. No standby list is enabled.',notifications);}
      this.save(volunteer.id,{stage:'standby',categoryId:c.id,eventId:c.event_id});return answer('category_standby_reconfirm','That place was filled. Reply YES again to join standby, or NO to cancel.',notifications);
    }
    if(full&&!c.standby_enabled){this.clear(volunteer.id);return answer('category_full','Standby is no longer enabled.',notifications);}
    const status=full?'standby':'confirmed',position=full?(this.db.prepare('SELECT COALESCE(MAX(standby_position),0)+1 n FROM signups WHERE category_id=?').get(c.id) as any).n:null;
    const time=now();this.db.prepare('INSERT INTO signups(event_id,volunteer_id,status,standby_position,created_at,updated_at,category_id) VALUES(?,?,?,?,?,?,?)').run(c.event_id,volunteer.id,status,position,time,time,c.id);this.save(volunteer.id,{stage:'finished',eventId:c.event_id,categoryId:c.id});
    return answer(`signup_${status}`,`Hermes Non-Profit: ${status==='confirmed'?'Confirmed':'On standby'} for ${c.event_name}, ${this.date(c)} - ${c.name}.${full?` Standby position ${position}.`:c.completion_report_required?` When finished, reply DONE ${c.event_slug}.`:''} Reply DROP to cancel or STOP to opt out.`,notifications);
  }
  private reserveQueuedCapacity(categoryId:number,notifications:Notification[]){
    const c=this.eligibleCategory(categoryId);if(!c||!c.standby_enabled)return;
    const counts=this.categories(c.event_id).find(x=>x.id===categoryId)!;
    const queued=this.db.prepare("SELECT COUNT(*) n FROM signups s JOIN volunteers v ON v.id=s.volunteer_id WHERE s.category_id=? AND s.status='standby' AND v.sms_status='opted_in'").get(categoryId) as any;
    const toReserve=Math.min(counts.unfilledCount,Math.max(0,queued.n-counts.reservedCount));
    for(let i=0;i<toReserve;i++)this.db.prepare("INSERT INTO standby_openings(event_id,status,created_at,updated_at,category_id) VALUES(?,'pending',?,?,?)").run(c.event_id,now(),now(),categoryId);
    this.advance(categoryId,notifications);
  }
  advance(categoryId:number,notifications:Notification[]){
    const c=this.eligibleCategory(categoryId);if(!c||!c.standby_enabled)return;
    if(this.db.prepare("SELECT id FROM standby_offers WHERE category_id=? AND status='pending'").get(categoryId))return;
    while(true){const opening=this.db.prepare("SELECT id FROM standby_openings WHERE category_id=? AND status='pending' ORDER BY id LIMIT 1").get(categoryId) as any;if(!opening)return;
      const candidate=this.db.prepare(`SELECT s.*,v.phone_e164 FROM signups s JOIN volunteers v ON v.id=s.volunteer_id WHERE s.category_id=? AND s.status='standby' AND v.sms_status='opted_in'
        AND NOT EXISTS(SELECT 1 FROM standby_offers o WHERE o.opening_id=? AND o.signup_id=s.id) ORDER BY s.standby_position,s.created_at,s.id LIMIT 1`).get(categoryId,opening.id) as any;
      if(!candidate){this.db.prepare("UPDATE standby_openings SET status='exhausted',updated_at=? WHERE id=?").run(now(),opening.id);continue;}
      const time=now();this.db.prepare("INSERT INTO standby_offers(opening_id,event_id,signup_id,volunteer_id,status,offered_at,created_at,updated_at,category_id) VALUES(?,?,?,?,'pending',?,?,?,?)").run(opening.id,c.event_id,candidate.id,candidate.volunteer_id,time,time,time,categoryId);
      if(this.context(candidate.volunteer_id)?.stage==='finished')this.clear(candidate.volunteer_id);
      notifications.push({to:candidate.phone_e164,body:`Hermes Non-Profit: A ${c.name} place opened for ${c.event_name}, ${this.date(c)}. Reply YES to accept or NO to pass. Reply STOP to opt out.`,volunteerId:candidate.volunteer_id,eventId:c.event_id,classification:'standby_offer'});return;
    }
  }
  cancel(signup:any,notifications:Notification[]){
    const time=now();this.db.prepare("UPDATE signups SET status='cancelled',cancelled_at=?,updated_at=? WHERE id=?").run(time,time,signup.id);
    this.db.prepare("UPDATE standby_offers SET status='cancelled',responded_at=?,updated_at=? WHERE signup_id=? AND status='pending'").run(time,time,signup.id);
    const c=this.eligibleCategory(signup.category_id);
    if(signup.status==='confirmed'&&c?.standby_enabled)this.db.prepare("INSERT INTO standby_openings(event_id,status,created_at,updated_at,category_id) VALUES(?,'pending',?,?,?)").run(signup.event_id,time,time,signup.category_id);
    this.advance(signup.category_id,notifications);
  }
  respondOffer(volunteer:Volunteer,offerId:number,accept:boolean):Reply{
    const offer=this.db.prepare("SELECT * FROM standby_offers WHERE id=? AND volunteer_id=? AND status='pending'").get(offerId,volunteer.id) as any;
    if(!offer)return answer('offer_missing','That offer is no longer pending.');
    const c=this.eligibleCategory(offer.category_id),time=now(),notifications:Notification[]=[];
    const signup=this.db.prepare('SELECT * FROM signups WHERE id=?').get(offer.signup_id) as any;
    if(!c||volunteer.sms_status!=='opted_in'||signup.status!=='standby'){
      this.db.prepare("UPDATE standby_offers SET status='expired',responded_at=?,updated_at=? WHERE id=?").run(time,time,offer.id);this.db.prepare("UPDATE standby_openings SET status='cancelled',updated_at=? WHERE id=?").run(time,offer.opening_id);return answer('offer_conflict','That offer is no longer available.');
    }
    const counts=this.categories(c.event_id).find(x=>x.id===c.id)!;
    if(accept&&counts.confirmedCount>=c.capacity)return answer('offer_conflict','That category is full.');
    this.db.prepare('UPDATE standby_offers SET status=?,responded_at=?,updated_at=? WHERE id=?').run(accept?'accepted':'declined',time,time,offer.id);
    if(accept){this.db.prepare("UPDATE signups SET status='confirmed',updated_at=? WHERE id=?").run(time,signup.id);this.db.prepare("UPDATE standby_openings SET status='filled',updated_at=? WHERE id=?").run(time,offer.opening_id);}
    this.advance(c.id,notifications);
    return answer(accept?'offer_accepted':'offer_declined',accept?`Confirmed for ${c.event_name}, ${this.date(c)} - ${c.name}.${c.completion_report_required?` When finished, reply DONE ${c.event_slug}.`:''} Reply DROP to cancel.`:'You declined this opening and remain on standby.',notifications);
  }
  private actionLabel(action:Action){if(action.kind==='offer'){const offer=this.db.prepare('SELECT * FROM standby_offers WHERE id=?').get(action.offerId) as any;const event=this.db.prepare('SELECT * FROM events WHERE id=?').get(offer?.event_id) as any;const c=offer?.category_id?this.db.prepare('SELECT name FROM event_categories WHERE id=?').get(offer.category_id) as any:null;return `Standby offer: ${event?.name}, ${event?this.date(event):''}${c?` - ${c.name}`:''}`;}const c=this.eligibleCategory(action.categoryId!);return `${action.kind==='standby'?'Join standby':'Signup'}: ${c?.event_name??'event'}, ${c?this.date(c):''} - ${c?.name??'category'}`;}
  private chooseAction(volunteerId:number,actions:Action[]):Reply{this.save(volunteerId,{stage:'actions',actions});return answer('response_ambiguous','Which action?\n'+actions.map((a,i)=>`${i+1}. ${this.actionLabel(a)}`).join('\n')+'\nReply with a number, then YES to accept or NO to decline.');}
  handle(volunteer:Volunteer,body:string,callbacks:{acceptGeneric:(id:number)=>Reply;declineGeneric:(id:number)=>Reply;drop:(id:number)=>Reply|null}):Reply|null{
    const text=body.trim().replace(/\s+/g,' ').toUpperCase();
    if(text==='STOP'){this.clear(volunteer.id);return null;}
    const ctx=this.context(volunteer.id);
    if(ctx)this.save(volunteer.id,ctx);
    if(text==='DROP'){
      const signups=this.db.prepare("SELECT s.*,e.name,e.starts_at,e.timezone,c.name category_name FROM signups s JOIN events e ON e.id=s.event_id LEFT JOIN event_categories c ON c.id=s.category_id WHERE s.volunteer_id=? AND s.status IN('confirmed','standby') AND e.status='published' ORDER BY e.starts_at,s.id").all(volunteer.id) as any[];
      if(!signups.length){this.clear(volunteer.id);return answer('drop_not_found','No active assignment was found.');}
      if(signups.length===1){this.clear(volunteer.id);return callbacks.drop(signups[0].id);}
      this.save(volunteer.id,{stage:'drop',ids:signups.map(s=>s.id)});return answer('drop_ambiguous','Choose the assignment to CANCEL:\n'+signups.map((s,i)=>`${i+1}. ${s.name}, ${this.date(s)}${s.category_name?` - ${s.category_name}`:''}`).join('\n')+'\nReply with its number to cancel that assignment.');
    }
    if(/^\d+$/.test(text)){
      if(!ctx)return answer('context_missing','That choice expired or has no active question. Text a category keyword to start again.');
      const index=Number(text)-1;if(index<0)return answer('invalid_choice','Reply with one of the listed numbers.');
      if(ctx.stage==='actions'){const action=ctx.actions?.[index];if(!action)return answer('invalid_choice','Reply with one of the listed numbers.');this.save(volunteer.id,{stage:'action_confirm',action});return answer('action_confirmation',this.actionLabel(action)+'. Reply YES to accept or NO to decline.');}
      const id=ctx.ids?.[index];if(!id)return answer('invalid_choice','Reply with one of the listed numbers.');
      if(ctx.stage==='drop'){this.clear(volunteer.id);return callbacks.drop(id)??answer('drop_not_found','That assignment is no longer active.');}
      if(ctx.stage==='categories')return this.choose(volunteer,id);
      if(ctx.stage==='dates')return this.choose(volunteer,id);
      return answer('invalid_choice','Reply YES to confirm or NO to cancel.');
    }
    if(text==='NEXT'){if(ctx?.stage!=='dates')return answer('context_missing','Text a category keyword to see upcoming dates.');return this.dates(volunteer.id,ctx.categoryId!, (ctx.page??0)+1);}
    if(text==='YES'||text==='NO'){
      if(ctx?.stage==='finished'){
        const remaining=this.db.prepare("SELECT id FROM standby_offers WHERE volunteer_id=? AND status='pending' ORDER BY id").all(volunteer.id) as {id:number}[];
        if(remaining.length)return this.chooseAction(volunteer.id,remaining.map(o=>({kind:'offer',offerId:o.id})));
        return answer('offer_missing','The previous action is complete. No new assignment was changed.');
      }
      if(ctx?.stage==='actions')return answer('response_ambiguous','Reply with a listed action number first, then YES to accept or NO to decline.');
      const offers=this.db.prepare("SELECT * FROM standby_offers WHERE volunteer_id=? AND status='pending' ORDER BY id").all(volunteer.id) as any[];
      let action:Action|undefined;
      if(ctx?.stage==='action_confirm')action=ctx.action;
      else{
        const actions:Action[]=offers.map(o=>({kind:'offer',offerId:o.id}));
        if(ctx?.stage==='signup'||ctx?.stage==='standby')actions.unshift({kind:ctx.stage,eventId:ctx.eventId!,categoryId:ctx.categoryId!});
        if(actions.length>1)return this.chooseAction(volunteer.id,actions);
        action=actions[0];
      }
      if(!action){if(ctx){this.clear(volunteer.id);return answer('request_cancelled','No signup was changed. Text a category keyword to start again.');}return null;}
      if(action.kind==='offer'){
        const offer=offers.find(o=>o.id===action!.offerId);this.clear(volunteer.id);if(!offer)return answer('offer_missing','That offer is no longer pending.');
        const response=offer.category_id?this.respondOffer(volunteer,offer.id,text==='YES'):text==='YES'?callbacks.acceptGeneric(offer.id):callbacks.declineGeneric(offer.id);
        this.save(volunteer.id,{stage:'finished'});return response;
      }
      if(text==='NO'){this.clear(volunteer.id);return answer('request_cancelled','Signup request cancelled; existing assignments are unchanged.');}
      return this.commitSignup(volunteer,{stage:action.kind,eventId:action.eventId!,categoryId:action.categoryId!});
    }
    const definition=this.db.prepare('SELECT d.id FROM category_definitions d WHERE d.keyword=? COLLATE NOCASE AND (d.active=1 OR EXISTS(SELECT 1 FROM event_categories c JOIN events e ON e.id=c.event_id WHERE c.category_id=d.id AND c.active=1 AND julianday(e.starts_at)>julianday(?))) ORDER BY d.active DESC,d.id DESC LIMIT 1').get(text,now()) as any;
    const event=this.db.prepare('SELECT id,status,starts_at FROM events WHERE slug=?').get(text) as any;
    if(!definition && !(event&&this.hasCategories(event.id)))return null;
    if(volunteer.sms_status!=='opted_in'){this.clear(volunteer.id);return answer('category_requires_opt_in','Reply JOIN to enroll before choosing a volunteer category.');}
    if(definition)return this.dates(volunteer.id,definition.id);
    const categories=this.categories(event.id).filter(c=>c.signupEligible);
    if(!categories.length){this.clear(volunteer.id);return answer('category_no_dates','That event is not open for signups.');}
    this.save(volunteer.id,{stage:'categories',eventId:event.id,ids:categories.map(c=>c.id)});
    return answer('category_choices','Choose a category:\n'+categories.map((c,i)=>`${i+1}. ${c.name}`).join('\n')+'\nReply with a number.');
  }
}
