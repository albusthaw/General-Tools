import { seed } from "./seed.mjs";

export default async function globalSetup() {
  await seed();
}
