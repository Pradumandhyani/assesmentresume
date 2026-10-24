Based on your README, you can run your DSA Assessment Platform (Student Frontend + Backend + Admin Frontend + PostgreSQL + Redis) using a single command after installing the prerequisites.

I'm giving you the commands in the correct order for Windows PowerShell inside VS Code.
Step 1 — Open your project folder
Open VS Code → Terminal → New Terminal (PowerShell).
cd "D:\myProjects\redResumes\Assignment\assessment-platform"


Step 2 — Check Node.js and Docker
node --version
docker --version
docker compose version
docker info


Your project requires Node.js 24.12.0 or later within version 24, and Docker Desktop must be running with the Linux/WSL2 engine.

If Docker is not running, start Docker Desktop first.
Step 3 — Install pnpm
npm.cmd install --global pnpm@10.34.6


Then:
$env:Path = "$env:APPDATA\npm;$env:Path"
pnpm.cmd --version


Expected pnpm version: 10.34.6.
Step 4 — Start your complete platform
Main command
Recommended

pnpm.cmd local:up


According to your README, this automatically prepares dependencies, PostgreSQL, Redis, migrations, seeds, login accounts, backend, frontend, admin, and maintenance worker.
 Copy startup commands
Keep this terminal open while using your application.
Step 5 — Open your applications
When startup reports ready:
Application	URL
Student login	http://localhost:3000/login
Admin login	http://localhost:3001/login
Backend health	http://localhost:4000/api/v1/health/live
Your automatically generated development login credentials should be available in:
assessment-platform/.local/credentials.json


Do not commit or share this file.
Step 6 — Check whether everything is working
Open a second VS Code terminal and run:
cd "D:\myProjects\redResumes\Assignment\assessment-platform"
pnpm.cmd local:check


You can also check the backend:
Invoke-RestMethod "http://localhost:4000/api/v1/health/live"


Invoke-RestMethod "http://localhost:4000/api/v1/health/ready"


Step 7 — Stop the project
pnpm.cmd local:down


This stops local services without deleting your database data.

Additional commands (only when needed)
You do not need to run these for normal one-command startup.
Task	PowerShell command
Install dependencies manually	pnpm.cmd install --frozen-lockfile
Start PostgreSQL and Redis	pnpm.cmd infra:up
Check infrastructure configuration	pnpm.cmd infra:config
Generate Prisma client	pnpm.cmd db:generate
Apply database migrations	pnpm.cmd db:migrate
Create development student	pnpm.cmd dev:student
Create development admin	pnpm.cmd dev:admin-user
Seed basic DSA questions	pnpm.cmd db:seed
Seed encrypted execution questions	pnpm.cmd db:seed:judge
Run all three applications manually	pnpm.cmd dev
Run backend only	pnpm.cmd dev:backend
Run student frontend only	pnpm.cmd dev:frontend
Run admin frontend only	pnpm.cmd dev:admin
Build entire project	pnpm.cmd build
Validate project	pnpm.cmd validate
Run backend tests	pnpm.cmd test:backend
Run frontend tests	pnpm.cmd test:frontend
Run admin tests	pnpm.cmd test:admin
Run browser tests	pnpm.cmd test:e2e
Start maintenance worker manually	pnpm.cmd worker:maintenance
Check security dependencies	pnpm.cmd security:audit
The encrypted execution seed and judge worker require additional toolchains, keys, and sandbox configuration.
Optional — Railway database
Only use these if you want to create a separate development PostgreSQL database on Railway, rather than use Docker's local database:
pnpm.cmd railway:login
pnpm.cmd railway:up


Your README states that Railway project creation was blocked by an outage on October 21, 2026. These commands will work only if Railway provisioning is available and your account has the necessary permissions.

Important: Your DSA judge is not automatically guaranteed to work
Your README explicitly says that actual Python, Java, and C++ code execution remains disabled until the real Linux gVisor sandbox verification passes.

Therefore, even if all three applications open successfully, the Run/Submit functionality may remain unavailable. Do not set EXECUTION_ENABLED=true simply to bypass this restriction.
Final — Commands you should run now
For your immediate goal of opening and testing the complete platform locally, this is the sequence:
# 1. Open project
cd "D:\myProjects\redResumes\Assignment\assessment-platform"

# 2. Verify prerequisites
node --version
docker --version
docker compose version

# 3. Install pnpm
npm.cmd install --global pnpm@10.34.6

# 4. Make pnpm available
$env:Path = "$env:APPDATA\npm;$env:Path"

# 5. Start entire platform
pnpm.cmd local:up


Once it starts, open the three URLs above. To verify services from another terminal, run pnpm.cmd local:check.

You don't need to manually run db:seed, db:migrate, dev:backend, dev:frontend, or dev:admin when local:up completes successfully.