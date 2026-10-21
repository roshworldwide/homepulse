# Deploying the "try to break in" page to AWS

The page lives in the main server (`/break-it`, with its API under `/api/break-it/`). For the public version, the same container runs with `DEMO_MODE` off, `/` pointing at the page, and Amazon Bedrock as the model.

**Where:** Amazon ECS Express Mode. The blueprint named App Runner, but [App Runner no longer takes new customers](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html). AWS points to ECS Express Mode instead: one call creates a Fargate service, a public HTTPS endpoint (`https://<name>.ecs.<region>.on.aws/`), a load balancer and auto scaling.

## One command

```bash
AWS_REGION=us-east-1 \
BEDROCK_MODEL_ID=<a multimodal model id with Converse tool use> \
ALERT_EMAIL=you@example.com \
./deploy/aws/deploy.sh
```

It builds and pushes the image to ECR, creates three IAM roles, creates the service, and adds a daily budget alarm. Read [`deploy.sh`](deploy.sh) first. It is written from the AWS CLI documentation and has not been run from this repository's CI, which has no AWS account.

| Step | What it creates |
| --- | --- |
| Image | ECR repository `homepulse`, image tagged with the git commit |
| Roles | `ecsTaskExecutionRole` and `ecsInfrastructureRoleForExpressServices` (AWS managed policies), and `homepulseTaskRole`, which may only call `bedrock:InvokeModel` ([`task-role-policy.json`](task-role-policy.json)) |
| Service | `homepulse-break-it`, port 8787, health check `/api/break-it/stats`, 1 to 2 tasks |
| Spend alarm | `homepulse-break-it-daily`: email at 80% and 100% of `DAILY_BUDGET_USD` (default 10) per day, all services |

## Protections

| Protection | Where |
| --- | --- |
| 10 attempts per connection per hour | App (`BREAK_IT_PER_ADDRESS_PER_HOUR`); the address comes from the load balancer's `X-Forwarded-For` because the image sets `TRUST_PROXY=1` |
| A cap on all attempts per hour, the real spend limit | App (`BREAK_IT_PER_HOUR`, 300 in the script) |
| 4 attempts at once, 90-second timeout | App (`BREAK_IT_CONCURRENCY`, `BREAK_IT_TIMEOUT_MS`) |
| Photos: JPEG or PNG under 2 MB, re-encoded so EXIF and GPS are dropped | App |
| Nothing personal stored: no words, photos or addresses, only hourly counts | App (addresses are held in memory as salted hashes for an hour, for the limit) |
| Every attempt gets its own fresh house: nothing carries over from one visitor to the next, which goes further than an hourly reset | App |
| Daily budget alarm | AWS Budgets (alerts arrive hours late, so the app caps come first) |
| No phone tokens handed out, console and log need a token from outside | Image defaults (`CONSOLE_EXPOSE_TOKENS=false`, `HOST=0.0.0.0` turns on token checks off-machine) |
| Host header checked (DNS rebinding) | `ALLOWED_HOSTS=.ecs.<region>.on.aws`; the load balancer's health checks use the task's own address, which is always allowed |

## After it is up

- Find the endpoint: `aws ecs describe-express-gateway-service --service-arn $(cat deploy/aws/.service-arn)`, or the ECS console.
- `/` redirects to `/break-it`. The QR code on the page points at the page itself; set `PUBLIC_URL` if you put a custom domain in front.
- Put the link and the QR code in the video's last frame and in the Devpost description.
- To stop paying, delete the service in the ECS console (or `aws ecs delete-express-gateway-service`; check `aws ecs delete-express-gateway-service help` for your CLI version).

## Run the same container locally

```bash
docker build -t homepulse .
docker run -p 8787:8787 -e ALLOWED_HOSTS=localhost homepulse    # offline stand-in
# with Bedrock: add -e MODEL_PROVIDER=bedrock -e BEDROCK_MODEL_ID=... -e AWS_REGION=... and AWS credentials
```
