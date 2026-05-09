import {
  globalVarsCreateGiftCards,
  globalVarsTooltips,
} from "../../../lib/config/create-gift-cards";
import type { CreateJobErrors } from "../../../lib/types/create-job";

interface CreateJobDetailsSectionProps {
  count: string;
  value: string;
  prefix: string;
  postfix: string;
  codeLength: string;
  note: string;
  expireDate: string;
  shopCurrency: string;
  isUnlimited: boolean;
  isAtLimit: boolean;
  remaining: number;
  errors: CreateJobErrors;
  /**
   * Hide the count input. Used when the gift-card count is derived from the
   * recipient list (1 customer → 1 gift card) rather than user-entered.
   */
  hideCount?: boolean;
  onCountChange: (value: string) => void;
  onValueChange: (value: string) => void;
  onPrefixChange: (value: string) => void;
  onPostfixChange: (value: string) => void;
  onCodeLengthChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onExpireDateChange: (value: string) => void;
  codeLengthOptions: Array<{ label: string; value: string }>;
}

export function CreateJobDetailsSection({
  count,
  value,
  prefix,
  postfix,
  codeLength,
  note,
  expireDate,
  shopCurrency,
  isUnlimited,
  isAtLimit,
  remaining,
  errors,
  hideCount = false,
  onCountChange,
  onValueChange,
  onPrefixChange,
  onPostfixChange,
  onCodeLengthChange,
  onNoteChange,
  onExpireDateChange,
  codeLengthOptions,
}: CreateJobDetailsSectionProps) {
  const countFieldMax = isUnlimited
    ? globalVarsCreateGiftCards.countMaxVolume
    : Math.max(1, Math.min(remaining, globalVarsCreateGiftCards.countMaxVolume));

  return (
    <>
      <s-tooltip id="code-length-tip">
        {globalVarsTooltips.createGiftCardLength}
      </s-tooltip>
      <s-tooltip id="prefix-tip">{globalVarsTooltips.createGiftCardPrefix}</s-tooltip>
      <s-tooltip id="postfix-tip">{globalVarsTooltips.createGiftCardPostfix}</s-tooltip>
      <s-tooltip id="expire-date-tip">
        {globalVarsTooltips.createGiftCardExpire}
      </s-tooltip>
      <s-stack direction="block" gap="base">
        <s-grid
          gridTemplateColumns={hideCount ? "1fr 1fr" : "1fr 1fr 1fr"}
          gap="base"
        >
          {!hideCount && (
            <s-number-field
              label="Count"
              value={count}
              min={1}
              max={countFieldMax}
              disabled={isAtLimit || undefined}
              onChange={(event: Event) =>
                onCountChange((event.target as HTMLInputElement).value)
              }
              error={errors.count}
            />
          )}

          <s-number-field
            label={`Value (${shopCurrency})`}
            value={value}
            min={0.01}
            step={0.01}
            max={globalVarsCreateGiftCards.valueMax}
            disabled={isAtLimit || undefined}
            onChange={(event: Event) =>
              onValueChange((event.target as HTMLInputElement).value)
            }
            error={errors.value}
          />

          <s-box>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              Code Length
              <s-icon interestFor="code-length-tip" type="info" />
            </s-stack>
            <s-select
              label="Code Length"
              labelAccessibilityVisibility="exclusive"
              value={codeLength}
              disabled={isAtLimit || undefined}
              onChange={(event: Event) =>
                onCodeLengthChange((event.target as HTMLSelectElement).value)
              }
              error={errors.codeLength}
            >
              {codeLengthOptions.map((option) => (
                <s-option key={option.value} value={option.value}>
                  {option.label}
                </s-option>
              ))}
            </s-select>
          </s-box>
        </s-grid>

        <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
          <s-box>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              Prefix
              <s-icon interestFor="prefix-tip" type="info" />
            </s-stack>
            <s-text-field
              label="Prefix"
              labelAccessibilityVisibility="exclusive"
              value={prefix}
              maxLength={globalVarsCreateGiftCards.prefixMaxChars}
              disabled={isAtLimit || undefined}
              onChange={(event: Event) =>
                onPrefixChange((event.target as HTMLInputElement).value)
              }
              error={errors.prefix}
            />
          </s-box>

          <s-box>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              Postfix
              <s-icon interestFor="postfix-tip" type="info" />
            </s-stack>
            <s-text-field
              label="Postfix"
              labelAccessibilityVisibility="exclusive"
              value={postfix}
              maxLength={globalVarsCreateGiftCards.postfixMaxChars}
              disabled={isAtLimit || undefined}
              onChange={(event: Event) =>
                onPostfixChange((event.target as HTMLInputElement).value)
              }
              error={errors.postfix}
            />
          </s-box>

          <s-box>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              Expire Date
              <s-icon interestFor="expire-date-tip" type="info" />
            </s-stack>
            <s-date-field
              label="Expire Date"
              labelAccessibilityVisibility="exclusive"
              value={expireDate}
              disabled={isAtLimit || undefined}
              onChange={(event: Event) =>
                onExpireDateChange((event.target as HTMLInputElement).value)
              }
              error={errors.expireDate}
            />
          </s-box>
        </s-grid>

        <s-text-area
          label="Note (only visible to you)"
          value={note}
          maxLength={globalVarsCreateGiftCards.noteMaxChars}
          disabled={isAtLimit || undefined}
          onChange={(event: Event) =>
            onNoteChange((event.target as HTMLTextAreaElement).value)
          }
          error={errors.note}
        />
      </s-stack>
    </>
  );
}
