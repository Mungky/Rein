from sqlalchemy import text
from tests.test_workspace_coordination import coordinated,suite,client
from tests.test_workspace_board import PROJECT,WORKER,OUTSIDER
from tests.test_workspace_logbook import create

def test_profile_photos_follow_pic_into_board_wo_and_team(coordinated):
    http=coordinated
    with http.sync_engine.begin() as conn:
        conn.execute(text("UPDATE profiles SET avatar_url=:avatar WHERE id=:person"),{'avatar':'https://example.test/avatar.png','person':WORKER})
    task=create(http).json();task_id=task['id']
    assert task['assigned_avatar_url']=='https://example.test/avatar.png'
    board=http.get(f'/api/workspace/projects/{PROJECT}/board').json()
    card=next(row for row in board['tasks'] if row['id']==task_id)
    assert card['planning']['assignees'][0]['avatar_url']=='https://example.test/avatar.png'
    detail=http.get(f'/api/workspace/tasks/{task_id}/work-order').json()
    assert detail['assignees'][0]['avatar_url']=='https://example.test/avatar.png'
    team=http.get(f'/api/workspace/projects/{PROJECT}/coordination').json()['members']
    assert next(person for person in team if person['profile_id']==str(WORKER))['avatar_url']=='https://example.test/avatar.png'

def test_scoped_document_upload_needs_no_recipient_form(coordinated):
    http=coordinated;task=create(http).json()['id']
    response=http.post(f'/api/workspace/projects/{PROJECT}/documents',data={'code':'ENG-COMPACT','title':'Detail Drawing','kind':'Gambar Detail','task_id':task},files={'file':('detail.pdf',b'detail drawing','application/pdf')})
    assert response.status_code==201,response.text
    doc=response.json()['id']
    assert any(row['document_id']==doc for row in http.get(f'/api/workspace/tasks/{task}/work-order').json()['attachments'])
    assert http.get(f'/api/workspace/project-documents/{doc}/download',headers={'X-Test-User':str(OUTSIDER)}).status_code==403

def test_activity_pages_search_every_record_and_keep_project_scope(coordinated):
    http=coordinated
    for _ in range(4):create(http)
    first=http.get(f'/api/workspace/projects/{PROJECT}/activity?limit=2&q=WO%20dibuat').json()
    second=http.get(f'/api/workspace/projects/{PROJECT}/activity?limit=2&offset=2&q=WO%20dibuat').json()
    assert first['total']==4 and len(first['items'])==2 and len(second['items'])==2
    assert not {row['id'] for row in first['items']}&{row['id'] for row in second['items']}
    assert http.get(f'/api/workspace/projects/{PROJECT}/activity',headers={'X-Test-User':str(OUTSIDER)}).status_code==403
    assert http.get(f'/api/workspace/projects/{PROJECT}/activity?offset=-1').status_code==422
