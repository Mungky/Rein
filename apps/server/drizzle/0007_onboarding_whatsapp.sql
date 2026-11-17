ALTER TABLE "users" ADD COLUMN "nickname" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pin_setup_skipped_at" timestamp with time zone;
--> statement-breakpoint
-- Akun yang sudah dipakai sebelum alur baru tetap dapat masuk.
UPDATE users SET onboarding_completed_at = now()
WHERE status = 'active' AND EXISTS (
  SELECT 1 FROM user_contacts c WHERE c.user_id = users.id AND c.verified_at IS NOT NULL
);
--> statement-breakpoint
UPDATE verification_codes SET expires_at = now()
WHERE purpose = 'verify_whatsapp' AND consumed_at IS NULL;
