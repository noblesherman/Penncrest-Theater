ALTER TABLE "SeniorSendoffForm"
  ADD COLUMN "questionConfig" JSONB;

ALTER TABLE "SeniorSendoffSubmission"
  ADD COLUMN "extraResponses" JSONB;
