import { TodoList } from "@/components/app/todo-list";
import { getSetting } from "@/lib/settings";
import { TODO } from "@/lib/todo";

export const dynamic = "force-dynamic";

export default async function TodoPage() {
  const done = await getSetting("todo_done").catch(() => ({}) as Record<string, boolean>);
  const left = TODO.filter((t) => !done[t.id] && !t.optional && !t.decision).length;
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Your to-do</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">Everything that only you can do, in the order to do it. Tick each one when it is done; your ticks are saved. {left === 0 ? "All required steps are done." : `${left} required step${left === 1 ? "" : "s"} left.`}</p>
      </div>
      <TodoList items={TODO} done={done} />
    </div>
  );
}
