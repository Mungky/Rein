import io
import json
import uuid
from datetime import date

from openpyxl import Workbook, load_workbook
from tests.test_workspace_coordination import coordinated, suite, client
from tests.test_workspace_board import PROJECT, OTHER_PROJECT, WORKER, OUTSIDER, TASKS
from tests.test_workspace_logbook import brief, create, restrict_worker
from scripts.workspace_preview import run_integration_migration


def detail(http, task):
    return http.get(f"/api/workspace/tasks/{task}/work-order").json()


def project_state(http):
    return http.get(f"/api/workspace/projects/{PROJECT}/coordination").json()


def test_auto_wo_numbers_multiple_pic_and_team_are_one_relation(coordinated):
    http=coordinated
    body=brief(pic_id=None,pic_ids=[str(WORKER),str(OUTSIDER)])
    first=create(http,body).json(); second=create(http).json()
    assert first['wo_number'] and second['wo_number']>first['wo_number']
    assert create(http,body).json()['wo_number']==first['wo_number']
    task=first['id']; data=detail(http,task)
    assert {a['id'] for a in data['assignees']}=={str(WORKER),str(OUTSIDER)}
    member=next(m for m in project_state(http)['members'] if m['profile_id']==str(OUTSIDER))
    assert any(wo['id']==task and wo['wo_number']==first['wo_number'] for wo in member['work_orders'])
    assert http.get(f"/api/workspace/tasks/{task}/work-order",headers={'X-Test-User':str(OUTSIDER)}).status_code==200
    body.update(pic_ids=[str(WORKER)],expected_updated_at=data['task']['updated_at'])
    assert http.put(f"/api/workspace/tasks/{task}/work-order",data={'metadata':json.dumps(body)}).status_code==200
    assert all(m['profile_id']!=str(OUTSIDER) for m in project_state(http)['members'])
    assert detail(http,task)['task']['wo_number']==first['wo_number']


def test_wo_drawing_is_one_document_with_shared_approval_download_and_assignment(coordinated):
    http=coordinated;payload=brief(attachment_kind='Gambar Detail')
    task=create(http,payload,[('files',('detail.pdf',b'canonical drawing','application/pdf'))]).json()['id']
    doc=next(d for d in project_state(http)['documents'] if d['task_id']==task)
    assert doc['source']=='work_order' and doc['kind']=='Gambar Detail' and doc['status']=='review'
    assert http.get(f"/api/workspace/project-documents/{doc['id']}/download").content==b'canonical drawing'
    assert http.post(f"/api/workspace/project-documents/{doc['id']}/approval",json={'decision':'approved','client_approved':True,'evidence':'Approved client email'}).status_code==200
    assert detail(http,task)['attachments'][0]['status']=='approved'
    other=create(http).json()['id']
    assert http.put(f"/api/workspace/project-documents/{doc['id']}/work-order",json={'task_id':other}).status_code==200
    assert detail(http,task)['attachments']==[]
    assert detail(http,other)['attachments'][0]['document_id']==doc['id']
    with http.sync_engine.connect() as conn:
        assert conn.exec_driver_sql("SELECT content IS NULL AND attachment_id IS NOT NULL FROM workspace_documents WHERE id=%s",(uuid.UUID(doc['id']),)).scalar()


def test_logbook_issue_and_photo_appear_in_shared_project_records_once(coordinated):
    http=coordinated;task=create(http).json()['id']
    assert http.post(f"/api/workspace/tasks/{task}/start").status_code==200
    body={'request_id':str(uuid.uuid4()),'work_date':str(date.today()),'body':'Material bracket belum datang','minutes':30,'is_issue':True}
    url=f"/api/workspace/tasks/{task}/logbook";files=[('files',('kendala.jpg',b'photo evidence','image/jpeg'))]
    assert http.post(url,data={'metadata':json.dumps(body)},files=files).status_code==201
    assert http.post(url,data={'metadata':json.dumps(body)},files=files).status_code==201
    state=project_state(http);issue=next(i for i in state['issues'] if i['task_id']==task)
    assert issue['source_log_id']==body['request_id'] and issue['kind']=='blocker'
    log=detail(http,task)['logs'][0]
    assert log['issue_id']==issue['id'] and log['issue_status']=='open'
    doc=next(d for d in state['documents'] if d['task_id']==task)
    assert doc['source']=='logbook' and doc['log_id']==body['request_id']
    assert http.put(f"/api/workspace/project-documents/{doc['id']}/work-order",json={'task_id':str(TASKS[0])}).status_code==409
    assert http.post(f"/api/workspace/project-issues/{issue['id']}/resolve",json={'resolution':'Material telah diterima','evidence':'Surat jalan 123'}).status_code==200
    assert http.post(f"/api/workspace/project-issues/{issue['id']}/verify").status_code==200
    assert detail(http,task)['logs'][0]['issue_status']=='verified'
    assert len([i for i in project_state(http)['issues'] if i.get('source_log_id')==body['request_id']])==1


def line(**extra):
    return {'request_id':str(uuid.uuid4()),'description':'Plat stainless','specification':'SS304 / 3 mm','quantity':4.5,'unit':'lembar','status':'requested','notes':'Untuk shell','task_id':None,**extra}


def test_material_rows_status_and_wo_link_share_one_record_with_stale_protection(coordinated):
    http=coordinated;task=create(http).json()['id'];body=line(task_id=task)
    url=f'/api/workspace/projects/{PROJECT}/material-list'
    first=http.post(url,json=body);assert first.status_code==201,first.text
    assert http.post(url,json=body).json()==first.json()
    rows=http.get(f'/api/workspace/projects/{PROJECT}/materials').json();row=rows[0]
    assert row['line_number']==1 and row['specification']=='SS304 / 3 mm'
    assert detail(http,task)['materials'][0]['id']==row['id']
    changed={**body,'status':'purchased','notes':'PO 123','expected_updated_at':row['updated_at']}
    assert http.put(f"/api/workspace/material-requests/{row['id']}/details",json=changed).status_code==200
    assert http.put(f"/api/workspace/material-requests/{row['id']}/details",json=changed).status_code==409
    assert detail(http,task)['materials'][0]['status']=='purchased'
    assert http.post(url,json=line(task_id=str(uuid.uuid4()))).status_code==422
    assert len(http.get(f'/api/workspace/projects/{PROJECT}/materials').json())==1


def xlsx(*rows):
    workbook=Workbook();sheet=workbook.active;sheet.title='Material'
    sheet.append(['Nomor','Description Material','Size Or Spesification','QTY','Satuan','Status','Note','WO'])
    for row in rows: sheet.append(row)
    stream=io.BytesIO();workbook.save(stream);return stream.getvalue()


def test_excel_template_preview_atomic_import_and_retry(coordinated):
    http=coordinated;task=create(http).json();number=task['wo_number']
    template=http.get(f'/api/workspace/projects/{PROJECT}/materials/template')
    assert template.status_code==200
    assert load_workbook(io.BytesIO(template.content)).active['B1'].value=='Description Material'
    data=xlsx([None,'Plat','SS304 3mm',2,'lembar','Add Req','Shell',f'WO-{number}'],[None,'Baut','M12',20,'pcs','Stock','Ready',None])
    files={'file':('material.xlsx',data,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
    prefix=f'/api/workspace/projects/{PROJECT}/materials'
    preview=http.post(prefix+'/import-preview',files=files)
    assert preview.status_code==200 and preview.json()['valid'],preview.text
    assert http.get(prefix).json()==[]
    batch={'request_id':str(uuid.uuid4())}
    assert http.post(prefix+'/import',files=files,data=batch).json()['count']==2
    assert http.post(prefix+'/import',files=files,data=batch).json()['count']==2
    rows=http.get(prefix).json();assert len(rows)==2 and [r['line_number'] for r in rows]==[1,2]
    assert rows[0]['task_id']==task['id'] and rows[1]['status']=='stock'
    assert len(detail(http,task['id'])['materials'])==1


def test_excel_invalid_row_formula_or_role_never_leaves_partial_import(coordinated):
    http=coordinated;prefix=f'/api/workspace/projects/{PROJECT}/materials'
    data=xlsx([None,'Valid',None,1,'pcs','Add Req',None,None],[None,'Invalid',None,-1,'pcs','PO',None,None])
    files={'file':('material.xlsx',data)}
    assert not http.post(prefix+'/import-preview',files=files).json()['valid']
    assert http.post(prefix+'/import',files=files,data={'request_id':str(uuid.uuid4())}).status_code==422
    assert http.get(prefix).json()==[]
    formula=xlsx([None,'Formula',None,'=1+1','pcs','Add Req',None,None])
    assert not http.post(prefix+'/import-preview',files={'file':('material.xlsx',formula)}).json()['valid']
    restrict_worker(http)
    data=xlsx([None,'Valid',None,1,'pcs','Add Req',None,None],[None,'Forbidden stock',None,1,'pcs','Stock',None,None])
    response=http.post(prefix+'/import',files={'file':('material.xlsx',data)},data={'request_id':str(uuid.uuid4())},headers={'X-Test-User':str(WORKER)})
    assert response.status_code==403,response.text
    assert http.get(prefix).json()==[]


def test_existing_attachment_backfill_is_idempotent_and_keeps_bytes(coordinated):
    http=coordinated;task=create(http,files=[('files',('legacy.pdf',b'preserved','application/pdf'))]).json()['id']
    with http.sync_engine.begin() as conn:
        conn.exec_driver_sql('DELETE FROM workspace_documents WHERE task_id=%s',(uuid.UUID(task),))
        run_integration_migration(conn);run_integration_migration(conn)
    docs=[d for d in project_state(http)['documents'] if d['task_id']==task]
    assert len(docs)==1
    assert http.get(f"/api/workspace/project-documents/{docs[0]['id']}/download").content==b'preserved'


def test_document_and_issue_created_from_project_pages_are_visible_in_wo(coordinated):
    http=coordinated;task=create(http).json()['id']
    response=http.post(f'/api/workspace/projects/{PROJECT}/documents',data={'code':'QC-123','title':'QC Report','kind':'Dokumen QC','recipient_ids':str(WORKER)},files={'file':('qc.pdf',b'QC evidence','application/pdf')})
    assert response.status_code==201,response.text
    doc=response.json()['id']
    assert http.put(f'/api/workspace/project-documents/{doc}/work-order',json={'task_id':task}).status_code==200
    assert any(file['document_id']==doc for file in detail(http,task)['attachments'])
    issue=http.post(f'/api/workspace/projects/{PROJECT}/issues',json={'kind':'blocker','title':'Akses site tertutup','pic_id':str(WORKER),'due_date':str(date.today())}).json()['id']
    assert http.put(f'/api/workspace/project-issues/{issue}/work-order',json={'task_id':task}).status_code==200
    assert any(item['id']==issue for item in detail(http,task)['issues'])


def test_legacy_wo_upload_also_registers_document_and_preserves_its_evidence(coordinated):
    http=coordinated;task=create(http).json()['id']
    response=http.post(f'/api/workspace/tasks/{task}/attachments',files={'file':('legacy-upload.pdf',b'legacy evidence','application/pdf')})
    assert response.status_code==201,response.text
    attachment=response.json()['id']
    assert any(doc['attachment_id']==attachment for doc in project_state(http)['documents'])
    assert http.delete(f'/api/workspace/attachments/{attachment}').status_code==409
