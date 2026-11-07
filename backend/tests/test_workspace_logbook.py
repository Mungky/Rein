import json
import uuid
from datetime import date

from tests.test_workspace_coordination import coordinated, suite, client
from tests.test_workspace_board import PROJECT, WORKER, OUTSIDER, TASKS


def brief(**extra):
    return {"request_id":str(uuid.uuid4()),"name":"Fabrikasi shell reactor","description":"Potong dan rolling plat sesuai gambar terlampir.",
        "pic_id":str(WORKER),"start_date":str(date.today()),"end_date":str(date.today()),**extra}


def create(http, body=None, files=None):
    return http.post(f"/api/workspace/projects/{PROJECT}/work-orders",data={"metadata":json.dumps(body or brief())},files=files or [])


def test_wo_has_one_pic_description_attachments_and_immediate_timeline(coordinated):
    body=brief()
    response=create(coordinated,body,[("files",("drawing.pdf",b"local drawing","application/pdf"))])
    assert response.status_code==201,response.text
    task=response.json();assert task["status"]=="todo" and task["assigned_to"]==str(WORKER)
    detail=coordinated.get(f"/api/workspace/tasks/{task['id']}/work-order").json()
    assert detail["start_date"]==body["start_date"] and detail["end_date"]==body["end_date"]
    assert detail["task"]["description"]==body["description"] and detail["attachments"][0]["name"]=="drawing.pdf"
    state=coordinated.get(f"/api/workspace/projects/{PROJECT}/coordination").json()
    assert next(c for c in state["controls"] if c["task_id"]==task["id"])["pic_id"]==str(WORKER)
    assert coordinated.post(f"/api/workspace/tasks/{task['id']}/start",headers={"X-Test-User":str(WORKER)}).status_code==200


def test_wo_creation_and_logbook_retries_are_atomic_and_idempotent(coordinated):
    http=coordinated;restrict_worker(http);body=brief();first=create(http,body)
    assert first.status_code==201,first.text
    assert create(http,body).json()["id"]==first.json()["id"]
    assert create(http,{**body,"name":"Different task"}).status_code==409
    task_id=first.json()["id"];headers={"X-Test-User":str(WORKER)}
    log={"request_id":str(uuid.uuid4()),"work_date":str(date.today()),"body":"Rolling shell selesai untuk bagian pertama.","minutes":180}
    url=f"/api/workspace/tasks/{task_id}/logbook"
    assert http.post(url,data={"metadata":json.dumps(log)},headers=headers).status_code==409
    assert http.post(f"/api/workspace/tasks/{task_id}/start",headers=headers).status_code==200
    files=[("files",("proses.jpg",b"local photo","image/jpeg"))]
    first=http.post(url,data={"metadata":json.dumps(log)},files=files,headers=headers)
    assert first.status_code==201,first.text
    assert http.post(url,data={"metadata":json.dumps(log)},files=files,headers=headers).json()["id"]==first.json()["id"]
    assert http.post(url,data={"metadata":json.dumps({**log,"body":"Changed record"})},files=files,headers=headers).status_code==409
    detail=http.get(f"/api/workspace/tasks/{task_id}/work-order").json()
    assert detail["task"]["status"]=="in_progress" and detail["log_total"]==1
    assert detail["logged_minutes"]==180 and len(detail["logs"][0]["attachments"])==1
    assert detail["attachments"]==[]
    assert http.post(f"/api/workspace/tasks/{task_id}/finish",headers=headers).status_code==403
    assert set_status(http,task_id,"pending_review",headers=headers).json()["status"]=="pending_review"
    assert set_status(http,task_id,"done",headers=headers).status_code==403
    assert http.post(f"/api/workspace/tasks/{task_id}/finish").json()["status"]=="done"
    assert http.post(f"/api/workspace/tasks/{task_id}/finish").json()["status"]=="done"


def test_whole_wo_rolls_back_when_any_attachment_is_invalid(coordinated):
    body=brief()
    response=create(coordinated,body,[("files",("drawing.pdf",b"drawing","application/pdf")),("files",("bad.html",b"script","text/html"))])
    assert response.status_code==415,response.text
    assert coordinated.get(f"/api/workspace/tasks/{body['request_id']}/work-order").status_code==404


def test_logbook_permissions_completion_and_date_validation(coordinated):
    http=coordinated;task=create(http).json()["id"]
    headers={"X-Test-User":str(WORKER)}
    assert http.post(f"/api/workspace/tasks/{task}/start",headers=headers).status_code==200
    assert set_status(http,task,"pending_review",headers=headers).status_code==409
    body={"request_id":str(uuid.uuid4()),"work_date":"2099-01-01","body":"Future work","minutes":0}
    assert http.post(f"/api/workspace/tasks/{task}/logbook",data={"metadata":json.dumps(body)},headers=headers).status_code==422
    body["work_date"]=str(date.today())
    assert http.post(f"/api/workspace/tasks/{task}/logbook",data={"metadata":json.dumps(body)},headers={"X-Test-User":str(OUTSIDER)}).status_code==403
    assert http.get(f"/api/workspace/tasks/{task}/work-order",headers={"X-Test-User":str(OUTSIDER)}).status_code==403


def test_edit_wo_reuses_single_pic_and_rejects_stale_changes(coordinated):
    http=coordinated;body=brief();task=create(http,body).json()["id"]
    detail=http.get(f"/api/workspace/tasks/{task}/work-order").json()
    changed={**body,"request_id":str(uuid.uuid4()),"description":"Deskripsi diperbarui","expected_updated_at":detail["task"]["updated_at"]}
    result=http.put(f"/api/workspace/tasks/{task}/work-order",data={"metadata":json.dumps(changed)})
    assert result.status_code==200,result.text
    assert http.put(f"/api/workspace/tasks/{task}/work-order",data={"metadata":json.dumps(changed)}).status_code==409
    detail=http.get(f"/api/workspace/tasks/{task}/work-order").json()
    assert detail["task"]["assigned_to"]==str(WORKER) and detail["task"]["description"]==changed["description"]


def test_rejected_daily_duration_never_leaves_partial_log_or_documentation(coordinated):
    http=coordinated;task=create(http).json()["id"];headers={"X-Test-User":str(WORKER)}
    assert http.post(f"/api/workspace/tasks/{task}/start",headers=headers).status_code==200
    body={"request_id":str(uuid.uuid4()),"work_date":str(date.today()),"body":"Pengerjaan pertama","minutes":1200}
    url=f"/api/workspace/tasks/{task}/logbook"
    assert http.post(url,data={"metadata":json.dumps(body)},headers=headers).status_code==201
    result=http.post(url,data={"metadata":json.dumps({**body,"request_id":str(uuid.uuid4()),"minutes":300})},
        files=[("files",("hasil.jpg",b"documentation","image/jpeg"))],headers=headers)
    assert result.status_code==409,result.text
    detail=http.get(f"/api/workspace/tasks/{task}/work-order").json()
    assert detail["log_total"]==1 and detail["logged_minutes"]==1200 and detail["logs"][0]["attachments"]==[]


def set_status(http, task_id, status, headers=None, **extra):
    detail=http.get(f"/api/workspace/tasks/{task_id}/work-order").json()
    return http.put(f"/api/workspace/tasks/{task_id}/work-order/status",headers=headers,
        json={"status":status,"expected_updated_at":detail["task"]["updated_at"],**extra})


def test_cancelled_wo_keeps_logbook_leaves_workload_and_can_be_reopened(coordinated):
    http=coordinated;restrict_worker(http);task=create(http).json()["id"]
    assert set_status(http,task,"cancelled").status_code==422
    assert set_status(http,task,"cancelled",headers={"X-Test-User":str(WORKER)},note="Wrong specification").status_code==403
    assert set_status(http,task,"in_progress").status_code==200
    body={"request_id":str(uuid.uuid4()),"work_date":str(date.today()),"body":"Sudah dipotong","minutes":30}
    assert http.post(f"/api/workspace/tasks/{task}/logbook",data={"metadata":json.dumps(body)}).status_code==201
    stale=http.get(f"/api/workspace/tasks/{task}/work-order").json()["task"]["updated_at"]
    assert set_status(http,task,"cancelled",note="Lingkup dibatalkan client").json()["status"]=="cancelled"
    assert http.put(f"/api/workspace/tasks/{task}/work-order/status",json={"status":"todo","expected_updated_at":stale}).status_code==409
    assert task not in {w["task_id"] for w in http.get('/api/workspace/operations/summary').json()['work']}
    assert all(task not in {j['task_id'] for j in p['jobs']} for p in http.get('/api/workspace/operations/manpower').json())
    detail=http.get(f"/api/workspace/tasks/{task}/work-order").json()
    assert detail['log_total']==1 and detail['logged_minutes']==30
    assert set_status(http,task,"todo").json()["status"]=="todo"
    assert http.get(f"/api/workspace/tasks/{task}/work-order").json()['log_total']==1


def test_reschedule_keeps_duration_pic_state_and_rejects_stale_or_unauthorized(coordinated):
    http=coordinated;restrict_worker(http);task=create(http,brief(start_date="2026-07-30",end_date="2026-08-02")).json()["id"]
    detail=http.get(f"/api/workspace/tasks/{task}/work-order").json()
    board_task=next(t for t in http.get(f"/api/workspace/projects/{PROJECT}/board").json()['tasks'] if t['id']==task)
    assert board_task['updated_at']==detail['task']['updated_at']
    body={"end_date":"2026-08-09","expected_updated_at":board_task['updated_at']}
    url=f"/api/workspace/tasks/{task}/work-order/schedule"
    assert http.put(url,json=body,headers={"X-Test-User":str(WORKER)}).status_code==403
    assert http.put(url,json=body).status_code==200
    assert http.put(url,json=body).status_code==409
    detail=http.get(f"/api/workspace/tasks/{task}/work-order").json()
    assert detail['start_date']=='2026-08-06' and detail['end_date']=='2026-08-09'
    assert detail['task']['status']=='todo' and detail['task']['assigned_to']==str(WORKER)
    assert set_status(http,task,'cancelled',note='Dibatalkan').status_code==200
    body['expected_updated_at']=http.get(f"/api/workspace/tasks/{task}/work-order").json()['task']['updated_at']
    assert http.put(url,json=body).status_code==409


def restrict_worker(http):
    # The migration seeds engineer planners/reviewers; this scenario uses an executor-only role.
    with http.sync_engine.begin() as conn:
        conn.exec_driver_sql("DELETE FROM role_permissions WHERE role = 'engineer_mechanical' AND permission IN ('workspace:manage','workspace:create_wo','workspace:review_wo')")


def test_removed_punch_items_do_not_appear_in_dashboard_or_block_project_closing(coordinated):
    http=coordinated
    response=http.post(f"/api/workspace/projects/{PROJECT}/issues",json={"kind":"punch","title":"Legacy punch","pic_id":str(WORKER),"due_date":str(date.today()),"task_id":str(TASKS[0])})
    assert response.status_code==201,response.text
    summary=http.get('/api/workspace/operations/summary').json()
    assert summary['counts']['open_issues']==0 and summary['issues']==[]
    with http.sync_engine.begin() as conn:
        conn.exec_driver_sql("UPDATE workspace_tasks SET status='done' WHERE phase_id IN (SELECT id FROM workspace_phases WHERE project_id=%s)",(PROJECT,))
    response=http.put(f"/api/workspace/projects/{PROJECT}",json={"status":"completed"})
    assert response.status_code==200,response.text
