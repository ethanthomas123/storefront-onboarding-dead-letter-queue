import express from "express";
import { ZodError } from "zod";
import { InfraiError, infrai } from "./infrai.js";
import { onboardingJobSchema } from "./onboarding_policy.js";

const app = express();
app.use(express.json());

app.post("/admin/onboarding-jobs", async (request, response) => {
  try {
    const job = onboardingJobSchema.parse(request.body);
    await infrai.queue.publish(job, `onboarding-${job.tenantId}-${job.operation}-${job.attempt}`);
    response.status(202).json({ accepted: true, tenantId: job.tenantId });
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({ error: "Invalid onboarding job", issues: error.issues });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.status(status).json({ error: error.code });
      return;
    }
    response.status(500).json({ error: "Unable to accept onboarding job" });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Onboarding service listening on http://localhost:${port}`));
