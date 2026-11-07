import { expect, test } from "bun:test";
import type { BoardTask } from "@/lib/api/workspace";
import { formatFileSize, picNames, workOrderLabel } from "./work-order-ui";

test("WO number is displayed without changing the saved work description",()=>{
  const task={wo_number:27,name:"Pembuatan panel"};
  expect(workOrderLabel(task)).toBe("WO-27 - Pembuatan panel");
  expect(task.name).toBe("Pembuatan panel");
  expect(workOrderLabel({name:"Pekerjaan lama"})).toBe("Pekerjaan lama");
});
test("every assigned PIC is displayed, with legacy primary-PIC fallback",()=>{
  expect(picNames({planning:{assignees:[{id:"1",name:"Andi"},{id:"2",name:"Budi"}]}} as BoardTask)).toBe("Andi, Budi");
  expect(picNames({assigned_name:"Candra"} as BoardTask)).toBe("Candra");
});
test("formatFileSize formats bytes, KB, and MB accurately", () => {
  expect(formatFileSize(500)).toBe("500 B");
  expect(formatFileSize(2048)).toBe("2 KB");
  expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
});
