/* notesTableToText — "Convert table to text" (NEW-2 / B649377).
 *
 * The owner: *"I'm trying to edit the table and basically pull things out of the table and
 * paste them."* What he actually wants is the four lines of contact detail an Outlook
 * signature block wraps in a table, OUT of the table — one right-click away, the way Word's
 * own "Convert Table to Text" works. Each row becomes a line: a plain paragraph, or — when the
 * table is the only thing inside a list item, exactly his Silvestri "Utility" case — a sibling
 * list item at the same level, so what used to read as one bullet holding a whole table now
 * reads as four ordinary bullet lines.
 *
 * ⛔ THE PASTE HALF OF THIS ASK IS ALREADY SHIPPED — read `notesPastePlain.js`'s
 * `isLayoutTable` / `tidyPastedFragment` before touching either file. "Content whose only
 * structure is a single-column table should come in as plain lines rather than a table" is
 * exactly what `isLayoutTable` (a table where every row has exactly one cell) already does on
 * every paste, in all three paste modes, including the default. It does NOT retroactively fix
 * a table already sitting in a saved note — that is what THIS file's command is for, run by
 * hand from the right-click menu on a table that predates the paste fix, or on one dropped in
 * some other way (e.g. drag-and-drop of an .html file).
 *
 * ⛔ CELLS KEEP THEIR MARKS. This never strips a link or a bold run — it only ever restructures
 * the BLOCK containers (table/row/cell → paragraph, or → listItem), so every inline node's
 * marks ride straight through. A multi-cell row is joined into one line with a plain " · "
 * separator (no mark of its own); a cell holding more than one block (a nested list, say) has
 * its blocks joined with a hardBreak so nothing is silently dropped, even though that cell's
 * own block structure does not survive being flattened to a single line — a stated limit, not
 * an oversight, and the one thing this command cannot promise for an unusually rich table.
 *
 * PURE core (`tableToBlockSpecs`) + a thin Tiptap command that turns the specs into real
 * schema nodes and performs the whole restructure as ONE transaction, so Ctrl+Z undoes it in
 * one step.
 */
import { Extension } from "@tiptap/core";

const CELL_TYPES = new Set(["tableCell", "tableHeader"]);
const ROW_SEPARATOR = " · ";

/** One cell's content flattened to a single line of inline-node specs (marks preserved).
 *  A cell holding several blocks (rare — usually a table cell is one paragraph) joins them
 *  with a hardBreak spec rather than dropping anything. Pure: reads a ProseMirror node,
 *  returns plain descriptors (`{ text, marks }` / `{ hardBreak: true }`), never a real node. */
export function cellLineSpec(cellNode) {
  const out = [];
  let blockIndex = 0;
  cellNode.forEach((block) => {
    if (blockIndex > 0) out.push({ hardBreak: true });
    blockIndex += 1;
    if (block.isTextblock) {
      block.forEach((inline) => {
        if (inline.isText) out.push({ text: inline.text, marks: inline.marks });
      });
    } else {
      const text = block.textContent;
      if (text) out.push({ text, marks: [] });
    }
  });
  return out;
}

/** One row → one line's worth of inline specs, cells joined by `ROW_SEPARATOR`. */
export function rowLineSpec(rowNode) {
  const out = [];
  let first = true;
  rowNode.forEach((cell) => {
    if (!CELL_TYPES.has(cell.type.name)) return;
    if (!first) out.push({ text: ROW_SEPARATOR, marks: [] });
    first = false;
    out.push(...cellLineSpec(cell));
  });
  return out;
}

/** A table → an array of row line-specs, one per `tableRow`. Pure and unit-tested on its own
 *  — the command below is the only part that has to touch a live editor. */
export function tableToBlockSpecs(tableNode) {
  const rows = [];
  tableNode.forEach((row) => {
    if (row.type.name === "tableRow") rows.push(rowLineSpec(row));
  });
  return rows;
}

/** A line-spec → real inline PM nodes, via the schema. */
function specToInline(schema, spec) {
  return spec.map((part) => (part.hardBreak
    ? schema.nodes.hardBreak.create()
    : schema.text(part.text, part.marks?.length ? part.marks : null)));
}

const NoteTableToText = Extension.create({
  name: "noteTableToText",

  addCommands() {
    return {
      /** Replace the table the caret/selection is inside with plain lines. Declines (returns
       *  false) when there is no enclosing table, so it is always safe to offer/bind. */
      convertTableToText: () => ({ state, tr, dispatch }) => {
        const { $from } = state.selection;
        let tableDepth = -1;
        for (let d = $from.depth; d >= 0; d -= 1) {
          if ($from.node(d).type.name === "table") { tableDepth = d; break; }
        }
        if (tableDepth < 0) return false;
        const tableNode = $from.node(tableDepth);
        const rowSpecs = tableToBlockSpecs(tableNode);
        if (!rowSpecs.length) return false;
        if (!dispatch) return true;

        const { schema } = state;
        const blocks = rowSpecs.map((spec) => {
          const inline = specToInline(schema, spec);
          return schema.nodes.paragraph.create(null, inline.length ? inline : undefined);
        });

        const tableStart = $from.before(tableDepth);
        const tableEnd = tableStart + tableNode.nodeSize;
        const parentDepth = tableDepth - 1;
        const parent = parentDepth >= 0 ? $from.node(parentDepth) : null;
        /* Both `listItem` (bullet/ordered) and `taskItem` (checklist) hold the table the same
         * way — reuse whichever one is actually in play rather than hard-coding `listItem`,
         * and copy its attrs (indent level, or a task's checked state) onto every new sibling
         * so the converted lines land at the SAME level the table was at. */
        const isListParent = parent && (parent.type.name === "listItem" || parent.type.name === "taskItem");

        /* ⛔ `tr` MUST COME FROM THE COMMAND'S OWN PROPS, NEVER FROM `state.tr` CALLED AGAIN
         * IN HERE. `state.tr` is a getter that hands back a FRESH `Transaction` on every read,
         * and Tiptap's single-command call (`editor.commands.x()`, which is what the menu row
         * uses) always dispatches the ONE `tr` it built before invoking this function and
         * threaded through as a prop — the `dispatch` callback these props hand you is a
         * NO-OP; only mutating the prop `tr` has any effect. Measured: the first version of
         * this command created its own `state.tr`, mutated THAT, called `dispatch(tr)`, and
         * `editor.commands.convertTableToText()` came back `true` while the stored document
         * was byte-identical — confirmed with `window.__noteEditor.runCommand`. */
        if (isListParent) {
          const newItems = blocks.map((b) => parent.type.create(parent.attrs, b));
          const itemStart = $from.before(parentDepth);
          const itemEnd = itemStart + parent.nodeSize;
          if (parent.childCount === 1) {
            /* The table was the item's ONLY content (Michael's Silvestri case) — the item
             * itself is nothing but the table, so replace the whole item with the new ones
             * rather than leaving an empty shell behind. */
            tr.replaceWith(itemStart, itemEnd, newItems);
          } else {
            /* The item holds other content too (e.g. a line above the table) — leave that
             * alone, remove just the table, and insert the new sibling items right after. */
            tr.delete(tableStart, tableEnd);
            tr.insert(tr.mapping.map(itemEnd), newItems);
          }
        } else {
          tr.replaceWith(tableStart, tableEnd, blocks);
        }
        dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});

export default NoteTableToText;
