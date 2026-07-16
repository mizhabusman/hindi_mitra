from tests.conftest import ADMIN_PASS


def _add_employee(admin_client, name, password="secret123"):
    """Create an employee the way an admin does (public self-registration is gone)."""
    r = admin_client.post(
        "/api/admin/users",
        json={"username": name, "display_name": name, "password": password, "role": "employee"},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_admin_login_password_only(client):
    r = client.post("/api/auth/admin-login", json={"password": ADMIN_PASS})
    assert r.status_code == 200 and r.json()["role"] == "admin"
    assert client.get("/api/auth/me").status_code == 200


def test_admin_login_wrong_password(client):
    assert client.post("/api/auth/admin-login", json={"password": "nope"}).status_code == 401


def test_public_registration_is_gone(client):
    # Employees can no longer self-register — only an admin creates accounts.
    assert client.post(
        "/api/auth/register-employee", json={"name": "Asha Verma", "password": "secret123"}
    ).status_code == 404


def test_employee_create_login_and_dropdown(admin_client):
    # admin creates a new employee
    emp_id = _add_employee(admin_client, "Asha Verma")

    # duplicate name → 409
    assert admin_client.post(
        "/api/admin/users",
        json={"username": "Asha Verma", "display_name": "Asha Verma", "password": "secret123", "role": "employee"},
    ).status_code == 409

    # appears in the dropdown list (by name)
    names = [e["name"] for e in admin_client.get("/api/auth/employees").json()]
    assert "Asha Verma" in names

    # employee login by id + password (replaces the admin session cookie)
    r = admin_client.post("/api/auth/employee-login", json={"user_id": emp_id, "password": "secret123"})
    assert r.status_code == 200 and r.json()["role"] == "employee"

    # wrong password rejected
    assert admin_client.post("/api/auth/employee-login", json={"user_id": emp_id, "password": "x"}).status_code == 401


def test_employee_cannot_use_admin_login(admin_client):
    _add_employee(admin_client, "Ravi Singh")
    # their password won't match an admin account
    assert admin_client.post("/api/auth/admin-login", json={"password": "secret123"}).status_code == 401


def test_employee_detail_endpoint(admin_client):
    emp_id = _add_employee(admin_client, "Meena Rao")
    d = admin_client.get(f"/api/admin/users/{emp_id}/detail")
    assert d.status_code == 200
    body = d.json()
    assert body["user"]["display_name"] == "Meena Rao"
    assert "metrics" in body and "conversations" in body and "history" in body


def test_employee_id_is_auto_generated_and_unique(admin_client):
    # Every created user gets a unique, formatted employee_id automatically.
    a = admin_client.post(
        "/api/admin/users",
        json={"username": "Nikhil A", "display_name": "Nikhil A", "password": "secret123", "role": "employee"},
    ).json()
    b = admin_client.post(
        "/api/admin/users",
        json={"username": "Nikhil B", "display_name": "Nikhil B", "password": "secret123", "role": "employee"},
    ).json()

    assert a["employee_id"] and b["employee_id"]
    assert a["employee_id"] != b["employee_id"]          # unique
    assert a["employee_id"].startswith("EMP")            # formatted
    assert a["employee_id"] == f"EMP{a['id']:04d}"       # derived from the id

    # The admin is a system account, not an employee — it must NOT have one.
    assert admin_client.get("/api/auth/me").json()["employee_id"] is None

    # Surfaced consistently across the API surfaces that expose an employee.
    metrics = {u["id"]: u for u in admin_client.get("/api/admin/users").json()}
    assert metrics[a["id"]]["employee_id"] == a["employee_id"]

    detail = admin_client.get(f"/api/admin/users/{a['id']}/detail").json()
    assert detail["user"]["employee_id"] == a["employee_id"]

    dropdown = {e["id"]: e for e in admin_client.get("/api/auth/employees").json()}
    assert dropdown[a["id"]]["employee_id"] == a["employee_id"]
