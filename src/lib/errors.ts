/**
 * An error caused by the caller's input (unknown ID, port not on the itinerary, ...).
 * Tool handlers turn it into an `isError` result whose message the model can act on.
 */
export class ToolInputError extends Error {
  override name = 'ToolInputError';
}
