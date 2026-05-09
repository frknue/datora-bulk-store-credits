import {
  AdminAction,
  Banner,
  BlockStack,
  Button,
  Checkbox,
  DatePicker,
  reactExtension,
  Select,
  Text,
  TextArea,
  TextField,
  useApi,
  // eslint-disable-next-line import/no-unresolved
} from "@shopify/ui-extensions-react/admin";
import { useState } from "react";
import {
  CREATE_JOB_RULES,
  buildCreateJobRequestBody,
  getFirstCreateJobValidationError,
  validateCreateJobInput,
} from "../../../shared/create-job";

const TARGET = "admin.customer-segment-details.action.render";

export default reactExtension(TARGET, () => <App />);

function App() {
  const { close, data, query } = useApi(TARGET);

  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [prefix, setPrefix] = useState("");
  const [postfix, setPostfix] = useState("");
  const [codeLength, setCodeLength] = useState("16");
  const [expireDate, setExpireDate] = useState("");
  const [scheduleDelivery, setScheduleDelivery] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [scheduledTimezone, setScheduledTimezone] = useState("");
  const [scheduledMessage, setScheduledMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);
  const [customerCount, setCustomerCount] = useState<number | null>(null);
  const [error, setError] = useState("");

  const segmentId = data.selected?.[0]?.id || null;

  const timezoneOptions = [
    { label: "Select timezone", value: "" },
    { label: "UTC", value: "UTC" },
    { label: "America/New_York (EST)", value: "America/New_York" },
    { label: "America/Chicago (CST)", value: "America/Chicago" },
    { label: "America/Los_Angeles (PST)", value: "America/Los_Angeles" },
    { label: "Europe/London (GMT)", value: "Europe/London" },
    { label: "Europe/Paris (CET)", value: "Europe/Paris" },
    { label: "Asia/Tokyo (JST)", value: "Asia/Tokyo" },
  ];

  const fetchAllCustomerIds = async (sid: string): Promise<string[]> => {
    const allIds: string[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
      const variables: Record<string, string> = { id: sid };
      if (cursor) variables.cursor = cursor;

      try {
        const result: {
          data?: {
            customerSegmentMembers?: {
              edges: { node: { id: string } }[];
              pageInfo: { hasNextPage: boolean; endCursor: string };
            };
          };
        } = await query(
          `query($id: ID!, $cursor: String) {
            customerSegmentMembers(first: 250, segmentId: $id, after: $cursor) {
              edges { node { id } }
              pageInfo { hasNextPage endCursor }
            }
          }`,
          { variables },
        );

        const members = result?.data?.customerSegmentMembers;
        if (members) {
          allIds.push(...members.edges.map((e: { node: { id: string } }) => e.node.id));
          hasNextPage = members.pageInfo.hasNextPage;
          cursor = members.pageInfo.endCursor;
        } else {
          hasNextPage = false;
        }
      } catch {
        hasNextPage = false;
      }
    }
    return allIds;
  };

  const validateForm = () => {
    const validationError = getFirstCreateJobValidationError(
      validateCreateJobInput(
        {
          count: customerCount ?? 1,
          value,
          note,
          prefix,
          postfix,
          codeLength,
          expireDate,
          scheduledSend: scheduleDelivery,
          scheduledDate,
          scheduledTime,
          scheduledTimezone,
          scheduledMessage,
        },
        {
          hasCustomerIds: true,
          isUnlimited: true,
          remaining: Number.POSITIVE_INFINITY,
        },
      ),
    );

    setError(validationError || "");
    return validationError === null;
  };

  const handleSubmit = async () => {
    if (!validateForm() || !segmentId) {
      if (!segmentId) setError("No segment selected");
      return;
    }

    setIsSubmitting(true);
    setIsLoadingCustomers(true);
    setError("");

    try {
      const customerIds = await fetchAllCustomerIds(segmentId);
      if (customerIds.length === 0) {
        setError("No customers found in this segment");
        setIsSubmitting(false);
        setIsLoadingCustomers(false);
        return;
      }

      setCustomerCount(customerIds.length);
      setIsLoadingCustomers(false);

      const response = await fetch("/api/jobs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildCreateJobRequestBody(
            {
              count: customerIds.length,
              value,
              note,
              prefix,
              postfix,
              codeLength,
              expireDate,
              scheduledSend: scheduleDelivery,
              scheduledDate,
              scheduledTime,
              scheduledTimezone,
              scheduledMessage,
            },
            {
              customerIdsList: customerIds,
              hasCustomerIds: true,
            },
          ),
        ),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create gift cards");
      }

      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsSubmitting(false);
      setIsLoadingCustomers(false);
    }
  };

  return (
    <AdminAction
      primaryAction={
        <Button onPress={handleSubmit} disabled={isSubmitting}>
          {isLoadingCustomers
            ? "Loading..."
            : isSubmitting
              ? "Creating..."
              : "Create Gift Cards"}
        </Button>
      }
      secondaryAction={
        <Button onPress={() => close()} disabled={isSubmitting}>
          Cancel
        </Button>
      }
    >
      <BlockStack gap="base">
        <Text fontWeight="bold">Create Gift Cards for Customer Segment</Text>
        {customerCount !== null ? (
          <Text>
            {customerCount} customer{customerCount !== 1 ? "s" : ""} in segment.
          </Text>
        ) : (
          <Text>Gift cards will be created for all customers in this segment.</Text>
        )}

        {error && <Banner tone="critical">{error}</Banner>}

        <TextField label="Gift Card Amount" value={value} onChange={setValue} required />
        <TextField
          label={`Code Length (${CREATE_JOB_RULES.codeLengthMin}-${CREATE_JOB_RULES.codeLengthMax})`}
          value={codeLength}
          onChange={setCodeLength}
        />
        <TextField
          label={`Prefix (max ${CREATE_JOB_RULES.prefixMaxChars})`}
          value={prefix}
          onChange={setPrefix}
          maxLength={CREATE_JOB_RULES.prefixMaxChars}
        />
        <TextField
          label={`Postfix (max ${CREATE_JOB_RULES.postfixMaxChars})`}
          value={postfix}
          onChange={setPostfix}
          maxLength={CREATE_JOB_RULES.postfixMaxChars}
        />
        <TextField
          label="Expire Date (YYYY-MM-DD)"
          value={expireDate}
          onChange={setExpireDate}
        />

        <TextArea
          label={`Note (${note.length}/${CREATE_JOB_RULES.noteMaxChars})`}
          value={note}
          onChange={setNote}
          rows={3}
          maxLength={CREATE_JOB_RULES.noteMaxChars}
        />

        <Checkbox checked={scheduleDelivery} onChange={setScheduleDelivery}>
          Schedule delivery for later
        </Checkbox>

        {scheduleDelivery && (
          <>
            <DatePicker
              selected={scheduledDate}
              onChange={(selected: string) => setScheduledDate(selected)}
            />
            <TextField
              label="Scheduled Time (HH:MM)"
              value={scheduledTime}
              onChange={setScheduledTime}
              placeholder="14:30"
            />
            <Select
              label="Timezone"
              value={scheduledTimezone}
              onChange={setScheduledTimezone}
              options={timezoneOptions}
            />
            <TextArea
              label={`Message (${scheduledMessage.length}/${CREATE_JOB_RULES.scheduledMessageMaxChars})`}
              value={scheduledMessage}
              onChange={setScheduledMessage}
              rows={3}
              maxLength={CREATE_JOB_RULES.scheduledMessageMaxChars}
            />
          </>
        )}
      </BlockStack>
    </AdminAction>
  );
}
