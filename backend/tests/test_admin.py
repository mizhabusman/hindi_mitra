from tests.conftest import ADMIN_PASS, ADMIN_USER


def test_overview(admin_client):
    r = admin_client.get("/api/admin/overview")
    assert r.status_code == 200
    assert r.json()["total_users"] >= 1


def test_user_lifecycle_and_rbac(admin_client):
    # create employee
    r = admin_client.post("/api/admin/users", json={"username": "emp_test", "password": "secret123", "role": "employee"})
    assert r.status_code == 201
    emp_id = r.json()["id"]

    # duplicate → 409
    assert admin_client.post("/api/admin/users", json={"username": "emp_test", "password": "secret123"}).status_code == 409

    # promote to manager
    assert admin_client.patch(f"/api/admin/users/{emp_id}", json={"role": "manager"}).json()["role"] == "manager"

    # metrics endpoint returns rows
    assert admin_client.get("/api/admin/users").status_code == 200

    # RBAC: switch to the manager account; admin routes forbidden
    admin_client.post("/api/auth/logout")
    admin_client.post("/api/auth/login", json={"username": "emp_test", "password": "secret123"})
    assert admin_client.get("/api/admin/users").status_code == 403

    # cleanup as admin
    admin_client.post("/api/auth/logout")
    admin_client.post("/api/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert admin_client.delete(f"/api/admin/users/{emp_id}").status_code == 204


def test_admin_cannot_delete_self(admin_client):
    me = next(u for u in admin_client.get("/api/admin/users").json() if u["username"] == ADMIN_USER)
    assert admin_client.delete(f"/api/admin/users/{me['id']}").status_code == 400
