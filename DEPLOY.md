# Deploying behind Azure Application Gateway

Run the app on **Azure App Service**, then put **Application Gateway** in front
as the public entry point, and lock the App Service down so it only accepts
traffic from the gateway.

```
Internet ──► Application Gateway (public IP, TLS, optional WAF) ──► App Service (this Node app) ──► Azure Storage
```

> The app already reads the port from `process.env.PORT`, so it runs on App
> Service unchanged. Just set the environment variables below.

---

Set a few names first (use your own; the app name must be globally unique):

```bash
RG=store-lab-rg
LOC=uksouth
APP=store-lab-<your-unique-suffix>
PLAN=store-lab-plan
SQLSRV=store-lab-sql-<your-unique-suffix>
```

## Part 1a: Azure SQL Database

```bash
az sql server create -g $RG -n $SQLSRV -l $LOC \
  --admin-user sqladmin --admin-password '<a-strong-password>'
az sql db create -g $RG -s $SQLSRV -n storelab --service-objective Basic
# Allow other Azure services (incl. App Service) to reach the SQL server:
az sql server firewall-rule create -g $RG -s $SQLSRV -n allow-azure \
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
```

Grab the ADO.NET connection string (SQL database → Connection strings → ADO.NET)
and fill in the password, you'll set it as an app setting below. The app creates
its tables (`schema.sql`) automatically on first start.

## Part 1b: App Service (the web app)

Create the plan + web app (Linux, Node 24):

```bash
az appservice plan create -g $RG -n $PLAN --is-linux --sku B1
az webapp create -g $RG -p $PLAN -n $APP --runtime "NODE:24-lts"
```

Set the app's configuration (these become environment variables). **Set
`SESSION_SECRET`**, without it the app generates a new random key on every
restart/instance, which logs everyone out:

```bash
az webapp config appsettings set -g $RG -n $APP --settings \
  AZURE_SQL_CONNECTION_STRING="Server=tcp:$SQLSRV.database.windows.net,1433;Database=storelab;User Id=sqladmin;Password=<a-strong-password>;Encrypt=true" \
  AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net" \
  SESSION_SECRET="$(openssl rand -hex 32)"

az webapp update -g $RG -n $APP --https-only true
```

Deploy the code from the project folder (zips, uploads, runs `npm install` +
`npm start` on the server):

```bash
az webapp up -g $RG -n $APP --runtime "NODE:24-lts"
```

Test it works on the default URL: `https://$APP.azurewebsites.net`.
(`package.json` already has `"start": "node server.js"`, so no startup command
is needed.)

> The app **boots even before the connection string is set**, it serves
> `/login` (so the gateway health probe passes) and shows a "setup needed" page
> for storage actions until you set `AZURE_STORAGE_CONNECTION_STRING` and
> restart. So deploy order doesn't matter, and a missing setting won't
> crash-loop the site.

---

## Part 2: Application Gateway in front

Easiest in the **Portal** → *Create a resource* → *Application Gateway*. The
settings that matter:

1. **Basics:** same region; SKU `WAF_v2` (firewall) or `Standard_v2`. Create a
   new VNet + a dedicated subnet for the gateway (e.g. `10.0.0.0/24`).
2. **Frontend:** create a new public IP.
3. **Backend pool:** target type **App Services** (or "IP address or FQDN") and
   enter the backend FQDN `'"$APP"'.azurewebsites.net`.
4. **Backend setting (HTTP settings), the important bit:**
   - Protocol **HTTPS**, port **443**
   - **"Use well known CA certificate" = Yes** (App Service has a trusted cert)
   - **"Override with new host name" → "Pick host name from backend target" = Yes.**
     App Service routes by the `Host` header, so the gateway must send
     `*.azurewebsites.net`, not the gateway's own name. *(If you skip this you
     get 404s from App Service.)*
   - **Custom probe:** path `/login` (returns `200`), and also tick "Pick host
     name from backend target".
5. **Listener:** the public IP, port **443** with your TLS cert (or port 80 for
   a quick test).
6. **Rule:** listener → backend pool → the HTTP setting above.

CLI alternative for the gateway, if you prefer:

```bash
az network public-ip create -g $RG -n agw-pip --sku Standard --allocation-method Static
az network vnet create -g $RG -n agw-vnet --address-prefix 10.0.0.0/16 \
  --subnet-name agw-subnet --subnet-prefix 10.0.0.0/24
az network application-gateway create -g $RG -n store-lab-agw --sku Standard_v2 \
  --public-ip-address agw-pip --vnet-name agw-vnet --subnet agw-subnet \
  --servers "$APP.azurewebsites.net" \
  --http-settings-protocol Https --http-settings-port 443 \
  --host-name-from-backend-pool true
# then add a custom probe with path /login and attach it to the HTTP settings
```

---

## Part 3: Lock down direct access

Otherwise anyone can bypass the gateway via `https://$APP.azurewebsites.net`.
Restrict the App Service to the gateway only:

```bash
# Allow ONLY the gateway's public IP; deny everything else.
AGW_IP=$(az network public-ip show -g $RG -n agw-pip --query ipAddress -o tsv)
az webapp config access-restriction add -g $RG -n $APP \
  --rule-name "allow-appgw" --priority 100 --action Allow --ip-address "$AGW_IP/32"
```

(For a stronger setup, give App Service a **Private Endpoint** and integrate the
gateway's VNet instead, but the IP restriction above is enough to start.)

---

## Part 4: Sessions (specific to this app)

This app keeps sessions **in memory**, so with a gateway in front:

- **Set `SESSION_SECRET`** (done in Part 1) so the cookie-signing key is stable.
- **Keep the App Service at one instance** (don't scale out), **or** turn on
  session stickiness so a user always hits the same instance:
  - Application Gateway: enable **cookie-based affinity** on the HTTP setting, **or**
  - leave App Service's built-in **ARR affinity** on (Configuration → General settings).
- For real multi-instance scale, swap the in-memory store for a shared one
  (e.g. Azure Cache for Redis with `connect-redis`). Not needed for a demo.

---

## Checklist

- [ ] Azure SQL database created; firewall allows Azure services; `AZURE_SQL_CONNECTION_STRING` set
- [ ] `AZURE_STORAGE_CONNECTION_STRING` set as an App Service setting
- [ ] `SESSION_SECRET` set (fixed random value)
- [ ] App reachable at `*.azurewebsites.net` before adding the gateway
- [ ] HTTP setting: HTTPS + **pick host name from backend target**
- [ ] Health probe path `/login` returns 200
- [ ] App Service access restricted to the gateway's IP (+ `--https-only true`)
- [ ] One instance, or session affinity enabled
