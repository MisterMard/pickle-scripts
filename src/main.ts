import { permsMenu } from "./scripts/permissions.js";
import readLine from "readline-sync";
import { miscMenu } from "./scripts/misc.js";
import { jarFeesMenu } from "./scripts/jars-fees.js";
import { chefAllocMenu } from "./scripts/chef-allocs.js";

export const menu = async () => {
  let done: boolean = false;
  while (!done) {
    console.log("Choose an option:");
    console.log("\t1) Permissions.");
    console.log("\t2) Jar Fees.");
    console.log("\t3) MiniChef & Rewarder.");
    console.log("\t4) Misc. Functions.");
    console.log("\t0) Exit");
    const choice = readLine.question("\tChoice: ", { limit: ["1", "2", "3", "4", "0"] });

    switch (choice) {
      case "0":
        done = true;
        break;
      case "1":
        await permsMenu();
        break;
      case "2":
        await jarFeesMenu();
        break;
      case "3":
        await chefAllocMenu();
        break;
      case "4":
        await miscMenu();
        break;
      default:
        console.log("Wrong Choice!");
        break;
    }
  }
}

menu();
