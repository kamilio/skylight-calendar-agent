import { createSkylightSDK, SkylightRequestError } from "../dist/index.js";

const sdk = createSkylightSDK();

void sdk.lists.create({ label: "Weekend" });
void sdk.calendar.eventEdit({ eventId: "event-1", clearCategories: true });
void sdk.tasks.chores({});
void sdk.auth.status({});
void sdk.auth.logout({});
void sdk.meals.createRaw({ bodyJson: { recipe_id: "recipe-1" } });
void sdk.photos.uploadMessage({ payloadJson: { file_upload: "upload-1" } });
void ((error: SkylightRequestError) => error.status);

// @ts-expect-error label is required
void sdk.lists.create({});
// @ts-expect-error unknown parameters must be rejected
void sdk.lists.create({ label: "Weekend", bogus: true });
