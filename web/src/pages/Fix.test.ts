import { describe, expect, it } from "vitest";
import { fixOrder } from "./Fix";
import type { ControlSummary } from "../lib/types";

const c = (id: string, severity: string, fail: number): ControlSummary => ({ profile: "p", id, title: id, severity, counts: { FAIL: fail } });

describe("fixOrder", () => {
  it("puts severity times failing hosts first, then the hosts, then the ID in natural order", () => {
    const list = [c("U-10", "low", 5), c("U-2", "high", 2), c("U-3", "medium", 3), c("U-1", "medium", 3), c("U-9", "high", 1)];
    // medium on 3 hosts and high on 2 both weigh 6: more hosts first; then low on 5 (5), high on 1 (3)
    expect(list.sort(fixOrder).map((x) => x.id)).toEqual(["U-1", "U-3", "U-2", "U-10", "U-9"]);
  });
});
