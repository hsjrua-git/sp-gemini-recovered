// Run against a migrated throwaway database. Committed race fixtures and their
// append-only audit trail intentionally survive until that database is dropped.
import assert from 'node:assert/strict';
import pg from 'pg';
import pool from '../db/pool.js';
import { attachAuditContext, auditContext } from '../lib/auditContext.js';
import { writeEvaluationCell } from '../lib/evaluationCell.js';
import { scanAlerts } from '../lib/alerts.js';

let checks = 0;
const pass = label => { checks++; console.log(`ok ${checks} - ${label}`); };
const one = async (db, sql, values) => (await db.query(sql, values)).rows[0];

async function fixture(db) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const student = await one(db, `INSERT INTO students
    (student_code,full_name,gender,birth_date,father_name,national_id)
    VALUES ($1,'Academic Probe','female','2000-01-01','Probe Father',$2) RETURNING id`,
  [suffix.toUpperCase().replace(/[01IO]/g, 'Z'), String(Math.floor(Math.random()*9e9)+1e9)]);
  const group = await one(db, 'INSERT INTO student_groups(code,name) VALUES ($1,$1) RETURNING id', [`G-${suffix}`]);
  const member = await one(db, `INSERT INTO student_group_members(student_id,group_id,joined_on)
    VALUES ($1,$2,current_date-40) RETURNING id`, [student.id,group.id]);
  const teacher = await one(db, `INSERT INTO teachers(code,full_name,birth_date,national_id)
    VALUES ($1,'Probe Teacher','1980-01-01',$2) RETURNING id`,
  [`T-${suffix}`,String(Math.floor(Math.random()*9e9)+1e9)]);
  const interval = await one(db, 'SELECT id FROM intervals WHERE archived_at IS NULL LIMIT 1');
  const assignment = await one(db, `INSERT INTO assignments(teacher_id,interval_id,group_id,anchor_date)
    VALUES ($1,$2,$3,current_date-20) RETURNING id,code`, [teacher.id,interval.id,group.id]);
  assert.ok(assignment.code.includes(group.id) === false && assignment.code.length > 0);
  const sessions = [];
  for (const days of [-20,-2,1]) sessions.push(await one(db, `INSERT INTO sessions(assignment_id,planned_date)
    VALUES ($1,current_date+$2::int) RETURNING id`, [assignment.id,days]));
  const parameter = await one(db, `INSERT INTO parameters(code,name,min_value,max_value,sort_order)
    VALUES ($1,$1,-10,300,900) RETURNING id`, [`P-${suffix}`]);
  return { student,group,member,teacher,assignment,sessions,parameter };
}

async function reject(db, sql, values, code = '23514') {
  await db.query('SAVEPOINT rejected_write');
  await assert.rejects(db.query(sql,values), error => error.code === code);
  await db.query('ROLLBACK TO SAVEPOINT rejected_write');
}

async function behavioralChecks() {
  const before = await one(pool,'SELECT count(*)::int AS n FROM audit_log');
  const db = await auditContext.run({ actor: 'academic-probe' }, () => pool.connect());
  try {
    await db.query('BEGIN');
    await db.query('SELECT lock_academic_write()');
    await db.query("SET LOCAL TIME ZONE 'Asia/Tehran'");
    const f = await fixture(db);
    await reject(db, "INSERT INTO students(student_code,full_name) VALUES ('ZZZZZZZZ','Missing Identity')", undefined, '23502');
    await reject(db, "UPDATE students SET birth_date='infinity' WHERE id=$1",[f.student.id]);
    await reject(db, 'INSERT INTO student_group_members(student_id,group_id) VALUES ($1,$2)',[f.student.id,f.group.id],'23502');
    pass('required identity, finite birth dates and explicit membership dates');

    const boundary = await one(db, `SELECT
      evaluation_lock_deadline('2026-01-01','2026-01-07 23:59:59 Asia/Tehran') = '2026-01-08 00:00 Asia/Tehran'::timestamptz AS early,
      evaluation_lock_deadline('2026-01-01','2026-01-08 00:00 Asia/Tehran') = '2026-01-09 00:00 Asia/Tehran'::timestamptz AS late`);
    assert.deepEqual(boundary,{early:true,late:true});
    pass('weekly boundary and 24-hour late window use the database timezone');

    const entry = {membershipId:f.member.id,parameterId:f.parameter.id,selected:true,
      qualityValue:null,quantityValue:null,qualityComment:null,quantityComment:null};
    await writeEvaluationCell(db,f.sessions[1].id,entry);
    const empty = await one(db,'SELECT * FROM evaluations WHERE session_id=$1',[f.sessions[1].id]);
    assert.equal(empty.locks_at,null);
    assert.equal(empty.first_answered_at,null);
    assert.equal((await one(db,'SELECT period_id FROM sessions WHERE id=$1',[f.sessions[1].id])).period_id,null);
    await writeEvaluationCell(db,f.sessions[1].id,{...entry,qualityValue:80,quantityValue:200}, {id:empty.id});
    const first = await one(db, 'SELECT first_answered_at::text,locks_at::text FROM evaluations WHERE id=$1',[empty.id]);
    await writeEvaluationCell(db,f.sessions[1].id,{...entry,qualityValue:90}, {id:empty.id});
    assert.deepEqual(await one(db,'SELECT first_answered_at::text,locks_at::text FROM evaluations WHERE id=$1',[empty.id]),first);
    await writeEvaluationCell(db,f.sessions[1].id,entry,{id:empty.id});
    await writeEvaluationCell(db,f.sessions[1].id,{...entry,selected:false},{id:empty.id});
    await writeEvaluationCell(db,f.sessions[1].id,{...entry,qualityComment:'Restored'}, {id:empty.id,archivedAt:true});
    assert.deepEqual(await one(db,'SELECT first_answered_at::text,locks_at::text FROM evaluations WHERE id=$1',[empty.id]),first);
    pass('selection stays open; edits, clearing, unselect and restoration preserve first-answer history');

    await db.query('UPDATE sessions SET moved_to=current_date+2 WHERE id=$1',[f.sessions[1].id]);
    assert.equal((await one(db,`SELECT locks_at=(current_date+9)::timestamptz AS anchored FROM evaluations WHERE id=$1`,[empty.id])).anchored,true);
    const locked = await one(db, `INSERT INTO evaluations(session_id,parameter_id,membership_id,quality_value,first_answered_at)
      VALUES ($1,$2,$3,50,now()-interval '2 days') RETURNING id,locks_at::text`,[f.sessions[0].id,f.parameter.id,f.member.id]);
    await reject(db,'UPDATE evaluations SET quality_value=60 WHERE id=$1',[locked.id]);
    await reject(db,'UPDATE evaluations SET archived_at=now() WHERE id=$1',[locked.id]);
    await reject(db,'DELETE FROM evaluations WHERE id=$1',[locked.id]);
    await db.query("SELECT set_config('app.override_reason','Correct historical entry',true)");
    await db.query('UPDATE evaluations SET quality_value=60 WHERE id=$1',[locked.id]);
    await db.query('UPDATE sessions SET moved_to=current_date WHERE id=$1',[f.sessions[0].id]);
    assert.equal((await one(db,'SELECT locks_at::text FROM evaluations WHERE id=$1',[locked.id])).locks_at,locked.locks_at);
    await db.query("SELECT set_config('app.override_reason','',true)");
    pass('session moves reanchor open cells; locked cells require reasons and keep their deadline');

    const period = await one(db,'SELECT period_id FROM sessions WHERE id=$1',[f.sessions[1].id]);
    await db.query('UPDATE periods SET archived_at=now() WHERE id=$1',[period.period_id]);
    assert.equal((await one(db,'SELECT period_id FROM sessions WHERE id=$1',[f.sessions[1].id])).period_id,period.period_id);
    assert.equal((await db.query('SELECT 1 FROM period_summary WHERE period_id=$1',[period.period_id])).rowCount,0);
    await db.query('UPDATE periods SET archived_at=NULL WHERE id=$1',[period.period_id]);
    assert.equal((await db.query('SELECT 1 FROM period_summary WHERE period_id=$1',[period.period_id])).rowCount,1);
    pass('period archive/restore retains session membership and hides/restores reports');

    await reject(db,'UPDATE student_group_members SET joined_on=current_date+3 WHERE id=$1',[f.member.id]);
    await reject(db,'UPDATE sessions SET moved_to=current_date-41 WHERE id=$1',[f.sessions[1].id]);
    await reject(db,'UPDATE assignments SET group_id=NULL,membership_id=$2 WHERE id=$1',[f.assignment.id,f.member.id]);
    await db.query('UPDATE evaluations SET archived_at=now() WHERE id=$1',[empty.id]);
    await reject(db,"UPDATE evaluations SET quality_comment='Edit archived' WHERE id=$1",[empty.id]);
    await db.query('UPDATE sessions SET archived_at=now() WHERE id=$1',[f.sessions[1].id]);
    await reject(db,'UPDATE evaluations SET archived_at=NULL WHERE id=$1',[empty.id]);
    pass('parent dates/targets and inactive-parent recovery respect retained history');

    await scanAlerts(db);
    await scanAlerts(db);
    const duplicateAlerts = await one(db, `SELECT count(*)::int AS n FROM
      (SELECT session_id FROM alerts WHERE resolved_at IS NULL GROUP BY session_id HAVING count(*)>1) duplicate`);
    assert.equal(duplicateAlerts.n,0);
    const audit = await one(db,`SELECT actor,old_data,new_data FROM audit_log
      WHERE entity_id=$1 AND action='evaluation.update' ORDER BY id DESC LIMIT 1`,[locked.id]);
    assert.equal(audit.actor,'academic-probe');
    assert.equal(audit.old_data.quality_value,50);
    assert.equal(audit.new_data.quality_value,60);
    await reject(db,"UPDATE audit_log SET actor='tamper'");
    await reject(db,'DELETE FROM audit_log');
    await reject(db,'TRUNCATE audit_log');
    pass('alert scanning is idempotent; row audit is attributed and append-only');
  } finally { await db.query('ROLLBACK'); db.release(); }
  assert.equal((await one(pool,'SELECT count(*)::int AS n FROM audit_log')).n,before.n);
  pass('rolled-back academic writes leave no committed audit records');
}

async function runRaces() {
  const db = await pool.connect();
  let f;
  try { await db.query('BEGIN'); await db.query('SELECT lock_academic_write()'); f=await fixture(db); await db.query('COMMIT'); }
  finally { db.release(); }
  const insert = (c) => c.query(`INSERT INTO evaluations(session_id,parameter_id,membership_id,quantity_value)
    VALUES ($1,$2,$3,40)`,[f.sessions[2].id,f.parameter.id,f.member.id]);
  await concurrent(
    c=>c.query('UPDATE parameters SET min_value=50 WHERE id=$1',[f.parameter.id]), insert,'23514');
  pass('parameter narrowing wins before competing evaluation validation');
  await pool.query('UPDATE parameters SET min_value=0 WHERE id=$1',[f.parameter.id]);
  await concurrent(insert,
    c=>c.query('UPDATE student_group_members SET left_on=current_date WHERE id=$1',[f.member.id]),'23514');
  pass('first answer wins before a competing membership end-date change');
  await concurrent(c=>c.query('UPDATE sessions SET note=$2 WHERE id=$1',[f.sessions[1].id,'version change']),
    c=>c.query('UPDATE student_group_members SET left_on=current_date WHERE id=$1',[f.member.id]),'40001','ISOLATION LEVEL REPEATABLE READ');
  pass('stale repeatable-read academic writers fail with a retryable serialization error');
}

async function concurrent(firstWrite,secondWrite,code,isolation='') {
  const a=await pool.connect(), b=await pool.connect();
  try {
    const {pid}=await one(b,'SELECT pg_backend_pid() AS pid');
    await a.query('BEGIN'); await b.query(`BEGIN ${isolation}`);
    if(isolation) await b.query('SELECT version FROM academic_invariant_lock');
    await firstWrite(a);
    const pending=secondWrite(b).then(()=>null,error=>error);
    let blocked=false;
    for(let attempt=0;attempt<100;attempt++) {
      blocked=(await one(pool,'SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[pid])).blocked;
      if(blocked) break;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.ok(blocked,'competing transaction reaches the write gate');
    await a.query('COMMIT');
    assert.equal((await pending)?.code,code);
  } finally {
    await a.query('ROLLBACK'); await b.query('ROLLBACK'); a.release(); b.release();
  }
}

async function actorIsolation() {
  const single=attachAuditContext(new pg.Pool({connectionString:process.env.DATABASE_URL,max:1}));
  try {
    const write = actor => auditContext.run({actor},()=>single.query(
      "INSERT INTO student_groups(code,name) VALUES ($1,$1) RETURNING id",[`actor-${actor}-${crypto.randomUUID().slice(0,8)}`]));
    const writes=await Promise.all([write('actor-one'),write('actor-two'),write('actor-three')]);
    for(const [index,result] of writes.entries()) {
      const row=await one(single,"SELECT actor FROM audit_log WHERE entity_id=$1 AND details->>'source'='database'",[result.rows[0].id]);
      assert.equal(row.actor,['actor-one','actor-two','actor-three'][index]);
    }
    const clean=await one(single,"SELECT current_setting('app.actor',true) AS actor,current_setting('app.override_reason',true) AS reason");
    assert.deepEqual(clean,{actor:'',reason:''});
    pass('concurrent request actors stay isolated across reused pool connections');
  } finally {await single.end();}
}

try {
  await behavioralChecks();
  await runRaces();
  await actorIsolation();
  console.log(`academic repair smoke: all ${checks} checks passed`);
} finally {await pool.end();}
