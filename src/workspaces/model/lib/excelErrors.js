/* The error codes Excel itself can store in a cell. Dependency-free (shared by the Excel writer and the evaluator). */
export const EXCEL_ERROR_CODES = new Set(["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"]);
