import {
  globalVarsCreateGiftCards,
  globalVarsTooltips,
} from "../lib/config/create-gift-cards";
import { formatNumber } from "../lib/utils/formatting";
export { CreateJobDetailsSection } from "../features/create-job/components/create-job-details-section";
import type {
  CreateJobErrors,
  CreateJobPresetOption,
  CreateJobTimezoneOption,
} from "../lib/types/create-job";

interface CreateJobPlanBannerProps {
  planName: string;
  isUnlimited: boolean;
  isAtLimit: boolean;
  remaining: number;
  planMaxAmount: number;
}

interface CreateJobCustomerBannerProps {
  customerCount: number;
}

interface CreateJobPresetSectionProps {
  presets: CreateJobPresetOption[];
  selectedPreset: string;
  onPresetChange: (value: string) => void;
  disabled?: boolean;
}

interface CreateJobSchedulingSectionProps {
  scheduledSend: boolean;
  scheduledDate: string;
  scheduledTime: string;
  scheduledTimezone: string;
  scheduledMessage: string;
  timezoneOptions: CreateJobTimezoneOption[];
  errors: CreateJobErrors;
  onScheduledSendChange: (checked: boolean) => void;
  onScheduledDateChange: (value: string) => void;
  onScheduledTimeChange: (value: string) => void;
  onScheduledTimezoneChange: (value: string) => void;
  onScheduledMessageChange: (value: string) => void;
}

interface CreateJobSavePresetSectionProps {
  savePreset: boolean;
  presetName: string;
  presetNameError?: string;
  onSavePresetChange: (checked: boolean) => void;
  onPresetNameChange: (value: string) => void;
  disabled?: boolean;
}

interface CreateJobSummarySectionProps {
  count: string;
  value: string;
  shopCurrency: string;
}

export function CreateJobPlanBanner({
  planName,
  isUnlimited,
  isAtLimit,
  remaining,
  planMaxAmount,
}: CreateJobPlanBannerProps) {
  return (
    <s-banner tone={isAtLimit ? "warning" : "info"}>
      <s-text>
        <strong>Plan Information:</strong> You are on the <strong>{planName}</strong> plan
        with{" "}
        {isUnlimited ? (
          <>
            <strong>unlimited</strong> gift card creation! Maximum of{" "}
            <strong>{formatNumber(globalVarsCreateGiftCards.countMaxVolume, 0)}</strong>{" "}
            gift cards per batch.
          </>
        ) : isAtLimit ? (
          <>
            monthly limit reached: <strong>{formatNumber(planMaxAmount, 0)}</strong> of{" "}
            <strong>{formatNumber(planMaxAmount, 0)}</strong> gift cards used this month.
          </>
        ) : (
          <>
            <strong>{formatNumber(remaining, 0)}</strong> of{" "}
            <strong>{formatNumber(planMaxAmount, 0)}</strong> gift cards remaining this
            month. Maximum of{" "}
            <strong>{formatNumber(globalVarsCreateGiftCards.countMaxVolume, 0)}</strong>{" "}
            gift cards per batch.
          </>
        )}
      </s-text>
    </s-banner>
  );
}

export function CreateJobCustomerBanner({ customerCount }: CreateJobCustomerBannerProps) {
  return (
    <s-banner tone="info">
      <s-text>
        <strong>{customerCount} customer(s)</strong> selected. Gift cards will be sent to
        these customers by email.
      </s-text>
    </s-banner>
  );
}

export function CreateJobPresetSection({
  presets,
  selectedPreset,
  onPresetChange,
  disabled = false,
}: CreateJobPresetSectionProps) {
  return (
    <s-select
      label="Load Preset"
      value={selectedPreset}
      details="Load a saved preset to auto-fill the form fields."
      onChange={(event: Event) =>
        onPresetChange((event.target as HTMLSelectElement).value)
      }
      disabled={disabled || undefined}
    >
      <s-option value="">Select Preset</s-option>
      {presets.map((preset) => (
        <s-option key={preset.id} value={preset.id}>
          {preset.name}
        </s-option>
      ))}
    </s-select>
  );
}

export function CreateJobSchedulingSection({
  scheduledSend,
  scheduledDate,
  scheduledTime,
  scheduledTimezone,
  scheduledMessage,
  timezoneOptions,
  errors,
  onScheduledSendChange,
  onScheduledDateChange,
  onScheduledTimeChange,
  onScheduledTimezoneChange,
  onScheduledMessageChange,
}: CreateJobSchedulingSectionProps) {
  return (
    <s-section heading="Email Scheduling">
      <s-tooltip id="scheduled-send-tip">
        {globalVarsTooltips.createGiftCardScheduledSendOut}
      </s-tooltip>
      <s-tooltip id="send-date-tip">
        {globalVarsTooltips.createGiftCardScheduledDate}
      </s-tooltip>
      <s-tooltip id="send-time-tip">
        {globalVarsTooltips.createGiftCardScheduledTime}
      </s-tooltip>
      <s-tooltip id="scheduled-message-tip">
        {globalVarsTooltips.createGiftCardScheduledMessage}
      </s-tooltip>
      <s-stack direction="block" gap="base">
        <s-checkbox
          label="Scheduled send out"
          checked={scheduledSend}
          details={globalVarsTooltips.createGiftCardScheduledSendOut}
          onChange={(event: Event) =>
            onScheduledSendChange((event.target as HTMLInputElement).checked)
          }
        />

        {scheduledSend && (
          <s-stack direction="block" gap="base">
            <s-grid
              gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr 1fr"
              gap="base"
            >
              <s-box>
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  Send Date
                  <s-icon interestFor="send-date-tip" type="info" />
                </s-stack>
                <s-date-field
                  label="Send Date"
                  labelAccessibilityVisibility="exclusive"
                  value={scheduledDate}
                  onChange={(event: Event) =>
                    onScheduledDateChange((event.target as HTMLInputElement).value)
                  }
                  error={errors.scheduledDate}
                />
              </s-box>

              <s-box>
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  Send Time
                  <s-icon interestFor="send-time-tip" type="info" />
                </s-stack>
                <s-text-field
                  label="Send Time"
                  labelAccessibilityVisibility="exclusive"
                  placeholder="HH:MM"
                  value={scheduledTime}
                  onInput={(event: Event) =>
                    onScheduledTimeChange((event.target as HTMLInputElement).value)
                  }
                  error={errors.scheduledTime}
                />
              </s-box>
            </s-grid>

            <s-select
              label="Timezone"
              value={scheduledTimezone}
              details={globalVarsTooltips.createGiftCardScheduledTimezone}
              error={errors.scheduledTimezone}
              onChange={(event: Event) =>
                onScheduledTimezoneChange((event.target as HTMLSelectElement).value)
              }
            >
              <s-option value="">Select timezone</s-option>
              {timezoneOptions.map((timezone) => (
                <s-option key={timezone.value} value={timezone.value}>
                  {timezone.label}
                </s-option>
              ))}
            </s-select>

            <s-box>
              <s-stack direction="inline" gap="small-200" alignItems="center">
                Message
                <s-icon interestFor="scheduled-message-tip" type="info" />
              </s-stack>
              <s-text-field
                label="Message"
                labelAccessibilityVisibility="exclusive"
                value={scheduledMessage}
                maxLength={globalVarsCreateGiftCards.scheduledMessageMaxChars}
                onInput={(event: Event) =>
                  onScheduledMessageChange((event.target as HTMLInputElement).value)
                }
                error={errors.scheduledMessage}
              />
            </s-box>
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}

export function CreateJobSavePresetSection({
  savePreset,
  presetName,
  presetNameError,
  onSavePresetChange,
  onPresetNameChange,
  disabled = false,
}: CreateJobSavePresetSectionProps) {
  return (
    <s-stack direction="block" gap="base">
      <s-checkbox
        label="Save Preset"
        checked={savePreset}
        onChange={(event: Event) =>
          onSavePresetChange((event.target as HTMLInputElement).checked)
        }
        disabled={disabled || undefined}
      />

      {disabled && (
        <s-text color="subdued">
          Saving and loading job presets is available on the Premium plan and
          above.{" "}
          <s-link href="/app/subscriptions">Upgrade your plan</s-link> to
          reuse form configurations across jobs.
        </s-text>
      )}

      {savePreset && (
        <s-text-field
          label="Preset Name"
          value={presetName}
          maxLength={globalVarsCreateGiftCards.presetMaxChars}
          onInput={(event: Event) =>
            onPresetNameChange((event.target as HTMLInputElement).value)
          }
          error={presetNameError}
          disabled={disabled || undefined}
        />
      )}
    </s-stack>
  );
}

export function CreateJobSummarySection({
  count,
  value,
  shopCurrency,
}: CreateJobSummarySectionProps) {
  return (
    <s-text>
      <strong>{formatNumber(parseInt(count, 10) || 0, 0)}</strong> gift cards at{" "}
      <strong>
        {formatNumber(parseFloat(value) || 0)} {shopCurrency}
      </strong>{" "}
      each = Total:{" "}
      <strong>
        {formatNumber((parseInt(count, 10) || 0) * (parseFloat(value) || 0))}{" "}
        {shopCurrency}
      </strong>
    </s-text>
  );
}
