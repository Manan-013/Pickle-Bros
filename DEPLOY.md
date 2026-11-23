# Putting PickleBros online

One container serves both the game page and the online server, on one address
(for example `https://picklebros.fly.dev`). Friends just open that link.

Rooms live in the server's memory, so run **one** server machine.

## Option A: Fly.io (recommended, deploys straight from this folder)

1. Install the Fly CLI (PowerShell):
   ```powershell
   iwr https://fly.io/install.ps1 -useb | iex
   ```
2. Sign up / log in (opens your browser; Fly asks for a card even for small apps):
   ```powershell
   fly auth login
   ```
3. Create the app from `fly.toml` (pick a unique name and the region nearest your players):
   ```powershell
   fly launch --no-deploy --copy-config --name <your-app-name>
   ```
4. Deploy, as a single machine:
   ```powershell
   fly deploy --ha=false
   ```
5. Open `https://<your-app-name>.fly.dev` and share it.

Later updates: run `fly deploy --ha=false` again.

The machine stops when nobody is connected and starts on the next visit (a few seconds).
Rooms in progress are lost when it stops or when you redeploy.

## Option B: Render / Railway / any Docker host

They need the code in a Git repository (e.g. GitHub). Create a **Web Service** from the repo,
choose **Docker** (it uses `Dockerfile`), set the port to `8080`, health check path `/health`,
and a single instance. On Render's free plan the service sleeps after ~15 minutes idle and
takes up to a minute to wake.

## Test the container locally

```powershell
docker build -t picklebros:local .
docker run --rm -p 8099:8080 picklebros:local
```
Then open http://localhost:8099.
