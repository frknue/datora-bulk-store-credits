import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import { useNavigate } from "react-router";
import imgFeature from "../images/bulk_gift_cards_feature_2.svg";

export interface OnboardingModalHandle {
  open: () => void;
}

const MODAL_ID = "onboarding-modal";

interface StepAction {
  label: string;
  destination: string | null;
}

interface OnboardingStep {
  title: string;
  content: string;
  image?: string;
  primaryAction: StepAction;
  secondaryAction?: StepAction;
}

const STEPS: OnboardingStep[] = [
  {
    title: "Welcome to Datora Bulk Store Credits",
    content:
      "Issue store credit in bulk to your Shopify customers — and create gift cards too, when you need them. This quick tour shows the essentials.",
    image: imgFeature,
    primaryAction: { label: "Start tour", destination: null },
  },
  {
    title: "Issue store credit in bulk",
    content:
      "Credit one customer or a whole segment with a chosen amount, currency, and optional expiry. Send right away or schedule it for later — perfect for refunds, loyalty rewards, and win-back campaigns.",
    primaryAction: { label: "Next", destination: null },
  },
  {
    title: "Gift cards, when you need them",
    content:
      "Generate gift cards by quantity, value, and optional expiry. Add prefixes or postfixes, pick recipients from your customer list or a Shopify segment, and email codes immediately or on a schedule.",
    primaryAction: { label: "Next", destination: null },
  },
  {
    title: "Download and export",
    content:
      "Preview rows on the download page before exporting. Pick separators, code casing, and grouping. Select multiple completed jobs to download them as a single CSV.",
    primaryAction: { label: "Next", destination: null },
  },
  {
    title: "Notifications and cleanup",
    content:
      "Get a Slack ping when jobs finish or fail, and let the app auto-deactivate older completed jobs so unused entries don't linger. All in one settings page.",
    primaryAction: { label: "Next", destination: null },
  },
  {
    title: "You're all set!",
    content:
      "Pick where to start. You can replay this tour any time from the Help Center.",
    primaryAction: {
      label: "Issue store credit",
      destination: "/app/store-credit/create",
    },
    secondaryAction: {
      label: "Create gift cards",
      destination: "/app/gift-cards/create",
    },
  },
];

function getModalElement():
  | (HTMLElement & {
      showOverlay(): void;
      hideOverlay(): void;
    })
  | null {
  return document.getElementById(MODAL_ID) as
    | (HTMLElement & {
        showOverlay(): void;
        hideOverlay(): void;
      })
    | null;
}

interface OnboardingModalProps {
  onComplete: () => void;
}

export const OnboardingModal = forwardRef<OnboardingModalHandle, OnboardingModalProps>(
  function OnboardingModal({ onComplete }, ref) {
    const navigate = useNavigate();
    const [currentStep, setCurrentStep] = useState(0);

    const totalSteps = STEPS.length;
    const step = STEPS[currentStep];
    const progress = ((currentStep + 1) / totalSteps) * 100;
    const isFirstStep = currentStep === 0;
    const isLastStep = currentStep === totalSteps - 1;

    const resetAndClose = useCallback(() => {
      getModalElement()?.hideOverlay();
      setCurrentStep(0);
      onComplete();
    }, [onComplete]);

    useImperativeHandle(
      ref,
      () => ({
        open() {
          setCurrentStep(0);
          setTimeout(() => getModalElement()?.showOverlay(), 0);
        },
      }),
      [],
    );

    const handleNext = useCallback(() => {
      if (isLastStep) {
        resetAndClose();
      } else {
        setCurrentStep((s) => s + 1);
      }
    }, [isLastStep, resetAndClose]);

    const handleBack = useCallback(() => {
      if (currentStep > 0) {
        setCurrentStep((s) => s - 1);
      }
    }, [currentStep]);

    const handleAction = useCallback(
      (destination: string | null) => {
        if (destination) {
          navigate(destination);
          resetAndClose();
        } else {
          handleNext();
        }
      },
      [navigate, resetAndClose, handleNext],
    );

    return (
      <s-modal id={MODAL_ID} heading="Getting Started">
        <s-stack direction="block" gap="base">
          {/* Progress bar */}
          <div
            style={{
              width: "100%",
              height: "6px",
              borderRadius: "999px",
              backgroundColor: "var(--p-color-bg-surface-secondary)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                backgroundColor: "var(--p-color-text)",
                borderRadius: "999px",
                transition: "width 0.3s ease",
              }}
            />
          </div>

          {/* Step content */}
          <s-box paddingBlockStart="small-200" paddingBlockEnd="small-200">
            <s-stack direction="block" gap="base">
              <s-heading>{step.title}</s-heading>

              {step.image && (
                <s-grid justifyItems="center" paddingBlock="small">
                  <s-box maxInlineSize="280px">
                    <s-image src={step.image} alt="Feature illustration" />
                  </s-box>
                </s-grid>
              )}

              <s-text>{step.content}</s-text>
            </s-stack>
          </s-box>

          <s-divider />

          {/* Step counter + back */}
          <s-stack direction="inline" alignItems="center" justifyContent="space-between">
            <s-text>
              Step {currentStep + 1} of {totalSteps}
            </s-text>
            {!isFirstStep && (
              <s-button variant="tertiary" onClick={handleBack}>
                Back
              </s-button>
            )}
          </s-stack>
        </s-stack>

        {/* Modal footer actions */}
        {!isLastStep && (
          <s-button
            slot="secondary-actions"
            commandFor={MODAL_ID}
            command="--hide"
            onClick={() => {
              setCurrentStep(0);
              onComplete();
            }}
          >
            Skip tour
          </s-button>
        )}
        {step.secondaryAction && (
          <s-button
            slot="secondary-actions"
            onClick={() => handleAction(step.secondaryAction!.destination)}
          >
            {step.secondaryAction.label}
          </s-button>
        )}
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={() => handleAction(step.primaryAction.destination)}
        >
          {step.primaryAction.label}
        </s-button>
      </s-modal>
    );
  },
);
