## ADDED Requirements

### Requirement: FE1 — A date is a real calendar day

Every date the app accepts as `AAAA-MM-DD` text (a form field, a use case input or a listing filter read from the URL) SHALL be checked for both its shape and its existence in the calendar, with ONE shared validator. A value such as `2026-02-30` or `2026-13-01` SHALL NOT reach the database. User decision (2026-11-04).

#### Scenario: Valid date

- **GIVEN** the value `2026-02-28`
- **WHEN** any form, use case or listing validates it as a date
- **THEN** it is accepted

#### Scenario: Leap day

- **GIVEN** the values `2028-02-29` and `2026-02-29`
- **WHEN** they are validated as dates
- **THEN** `2028-02-29` is accepted and `2026-02-29` is refused

#### Scenario: Well formed but non-existent date

- **GIVEN** the value `2026-02-30`
- **WHEN** any form, use case or listing validates it as a date
- **THEN** it is refused before any query runs

### Requirement: FE2 — An invalid date filter is ignored

A listing filtered by date through the URL SHALL drop a filter date that is malformed or does not exist in the calendar and show the listing as if that filter were not set, with no error message, while the other filters still apply. User decision (2026-11-04). A valid range whose `desde` is later than `hasta` keeps each listing's current behavior.

#### Scenario: Non-existent date in the URL

- **GIVEN** the preparaciones listing opened with `?desde=2026-02-30&hasta=2026-03-10`
- **WHEN** the page loads
- **THEN** the listing shows the results filtered only by `hasta = 2026-03-10`
- **AND** no error page or error message is shown
- **AND** there is no "desde" chip and the filter drawer's "desde" field is empty

#### Scenario: Malformed date in the URL

- **GIVEN** the auditoría listing opened with `?desde=05/11/2026`
- **WHEN** the page loads
- **THEN** the listing shows the results without the "desde" filter

#### Scenario: Other filters keep applying

- **GIVEN** the entregas listing opened with `?numero=123&ingresoDesde=2026-02-31`
- **WHEN** the page loads
- **THEN** the listing is filtered by `numero = 123` only

### Requirement: FE3 — An invalid date in a form marks its field

A form that receives a date that does not exist in the calendar SHALL refuse it, keep the rest of the user's input and mark that date field with "Debe ser una fecha que exista en el calendario." It SHALL NOT save anything and SHALL NOT show a generic error.

#### Scenario: Invoice lote with an impossible expiry date

- **GIVEN** a factura with one lote whose fecha de vencimiento arrives as `2027-06-31`
- **WHEN** the user confirms the factura
- **THEN** nothing is stored
- **AND** the lote's fecha de vencimiento field shows "Debe ser una fecha que exista en el calendario."
- **AND** every other field keeps what the user typed
