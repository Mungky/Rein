-- Lampiran polymorphic (owner_type/owner_id): pastikan pemiliknya ada (PRD §4.2 "trigger pemeriksa
-- keberadaan owner"). Validasi juga dilakukan di service layer; trigger ini pengaman terakhir.
CREATE OR REPLACE FUNCTION attachments_check_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  found boolean;
BEGIN
  CASE NEW.owner_type
    WHEN 'project' THEN SELECT EXISTS (SELECT 1 FROM projects WHERE id = NEW.owner_id) INTO found;
    WHEN 'wo' THEN SELECT EXISTS (SELECT 1 FROM work_orders WHERE id = NEW.owner_id) INTO found;
    WHEN 'logbook' THEN SELECT EXISTS (SELECT 1 FROM logbook_entries WHERE id = NEW.owner_id) INTO found;
    WHEN 'user' THEN SELECT EXISTS (SELECT 1 FROM users WHERE id = NEW.owner_id) INTO found;
    WHEN 'client' THEN SELECT EXISTS (SELECT 1 FROM clients WHERE id = NEW.owner_id) INTO found;
    ELSE found := false;
  END CASE;
  IF NOT found THEN
    RAISE EXCEPTION 'pemilik lampiran % % tidak ditemukan', NEW.owner_type, NEW.owner_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER attachments_owner_exists
  BEFORE INSERT OR UPDATE OF owner_type, owner_id ON attachments
  FOR EACH ROW EXECUTE FUNCTION attachments_check_owner();
