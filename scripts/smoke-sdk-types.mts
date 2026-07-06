import { createSkylightSDK } from "../dist/index.js";

const sdk = createSkylightSDK();

void sdk.lists.create({ label: "Weekend" });
void sdk.calendar.eventEdit({ eventId: "event-1", clearCategories: true });
void sdk.tasks.chores({});

// @ts-expect-error label is required
void sdk.lists.create({});
// @ts-expect-error unknown parameters must be rejected
void sdk.lists.create({ label: "Weekend", bogus: true });
