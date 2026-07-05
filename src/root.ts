import { defineGroup } from "toolcraft";
import { calendarGroup } from "./sections/calendar.js";
import { tasksGroup } from "./sections/tasks.js";
import { rewardsGroup } from "./sections/rewards.js";
import { listsGroup } from "./sections/lists.js";
import { mealsGroup } from "./sections/meals.js";
import { recipesGroup } from "./sections/recipes.js";
import { photosGroup } from "./sections/photos.js";
import { profilesGroup } from "./sections/profiles.js";

export const root = defineGroup({
  name: "skylight",
  description: "Skylight Calendar Agent",
  children: [
    calendarGroup,
    tasksGroup,
    rewardsGroup,
    listsGroup,
    mealsGroup,
    recipesGroup,
    photosGroup,
    profilesGroup,
  ],
});
