from tests.conftest import ADMIN_PASS


def test_admin_login_password_only(client):
    r = client.post("/api/auth/admin-login", json={"password": ADMIN_PASS})
    assert r.status_code == 200 and r.json()["role"] == "admin"
    assert client.get("/api/auth/me").status_code == 200


def test_admin_login_wrong_password(client):
    assert client.post("/api/auth/admin-login", json={"password": "nope"}).status_code == 401


def test_employee_register_login_and_dropdown(client):
    # register a new employee from the (public) employee login page
    r = client.post("/api/auth/register-employee", json={"name": "Asha Verma", "password": "secret123"})
    assert r.status_code == 201
    emp_id = r.json()["id"]

    # duplicate name → 409
    assert client.post("/api/auth/register-employee", json={"name": "Asha Verma", "password": "secret123"}).status_code == 409

    # appears in the dropdown list (by name)
    names = [e["name"] for e in client.get("/api/auth/employees").json()]
    assert "Asha Verma" in names

    # employee login by id + password
    r = client.post("/api/auth/employee-login", json={"user_id": emp_id, "password": "secret123"})
    assert r.status_code == 200 and r.json()["role"] == "employee"

    # wrong password rejected
    assert client.post("/api/auth/employee-login", json={"user_id": emp_id, "password": "x"}).status_code == 401


def test_employee_cannot_use_admin_login(client):
    client.post("/api/auth/register-employee", json={"name": "Ravi Singh", "password": "secret123"})
    # their password won't match an admin account
    assert client.post("/api/auth/admin-login", json={"password": "secret123"}).status_code == 401


def test_employee_detail_endpoint(admin_client):
    r = admin_client.post("/api/auth/register-employee", json={"name": "Meena Rao", "password": "secret123"})
    emp_id = r.json()["id"]
    d = admin_client.get(f"/api/admin/users/{emp_id}/detail")
    assert d.status_code == 200
    body = d.json()
    assert body["user"]["display_name"] == "Meena Rao"
    assert "metrics" in body and "conversations" in body and "history" in body
