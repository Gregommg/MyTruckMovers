# ICT Service Desk

A Django helpdesk for employee requests and ICT technician workflows. Employees can submit and track tickets; staff users can take tickets, start work, mark requests pending, and record a required resolution. Employees can confirm a fix or reopen the request. Every workflow action is recorded in ticket activity.

## Run locally

```bash
cd ICTSupport/ICTSupportDesk
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

Set a unique local `SECRET_KEY` in `.env`; the built-in fallback key is for local development only. The project defaults to SQLite if `DATABASE_URL` is not set. Sign in at `/accounts/login/`; use `/admin/` to create employee and ICT staff accounts. Set `is_staff` on technician accounts to give them access to the shared queue and ticket actions.

## Neon and Render deployment

1. Create a Neon PostgreSQL database and copy its pooled connection string. Set it as `DATABASE_URL` in the Render service environment, including `?sslmode=require`.
2. Configure the Render web service with root directory `ICTSupport/ICTSupportDesk`, build command `pip install -r requirements.txt && python manage.py collectstatic --noinput`, and start command `python manage.py migrate && gunicorn ICTSupportDesk.wsgi:application`.
3. Add `SECRET_KEY`, `DEBUG=False`, `ALLOWED_HOSTS`, and `CSRF_TRUSTED_ORIGINS` in Render's environment settings. Use comma-separated hosts/origins for multiple values.
4. Set `CLOUDINARY_URL` to a Cloudinary API URL to keep ticket attachments and photos in persistent object storage. Render's local filesystem is ephemeral, so leaving this unset is suitable for local development only.
5. After the first deploy, use the Render shell to run `python manage.py createsuperuser`, then create user accounts and mark ICT technicians as staff in Django admin.

Render's free web services may sleep and are not intended for production uptime; choose an appropriate service plan for operational use. Never commit `.env` or production credentials.
