import type { CreateJobFormValues, CreateJobPreset } from "../utils/create-job";
import type { CreateJobValidationErrors } from "../../../shared/create-job";

export type CreateJobErrors = CreateJobValidationErrors &
  Partial<Record<keyof CreateJobFormValues, string>>;

export type CreateJobPresetOption = Pick<CreateJobPreset, "id" | "name">;

export interface CreateJobTimezoneOption {
  label: string;
  value: string;
}
