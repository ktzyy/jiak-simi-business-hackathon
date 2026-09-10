# Hackathon product contract

Status: working agreement for the two hackathon product surfaces. This document defines behavior and shared object shapes; it is not a database migration.

## Common rules

- IDs are UUID strings.
- Dates crossing an interface are ISO 8601 timestamps in UTC.
- Money is stored and calculated as integer cents. The demo currency is `SGD`.
- The server, never the browser, calculates authoritative prices and order totals.
- Menu extraction and voice interpretation always produce a reviewable draft before they create or change live data.
- Demo records are synthetic. Do not copy production customers, orders or credentials.

## Shared objects

### Restaurant

Represents one eatery and its public storefront.

| Field | Shape | Meaning |
| --- | --- | --- |
| `id` | UUID | Stable internal identifier |
| `name` | string | Public restaurant name |
| `slug` | string | Stable URL/QR identifier |
| `description` | string or null | Public introduction |
| `primaryColor` | CSS colour string | Storefront brand colour |
| `logoUrl` | URL or null | Public logo asset |
| `published` | boolean | Whether the storefront can be shown publicly |

Staff authorization is determined by a separate restaurant-membership relationship, never by editable user profile metadata.

### Menu item

Represents one sellable item owned by a restaurant.

| Field | Shape | Meaning |
| --- | --- | --- |
| `id` | UUID | Stable item identifier |
| `restaurantId` | UUID | Owning restaurant |
| `category` | string | Customer-facing grouping |
| `name` | string | Display name |
| `description` | string or null | Customer-facing description |
| `priceCents` | non-negative integer | Base price in cents |
| `imageUrl` | URL or null | Public menu image |
| `available` | boolean | Whether it can be ordered now |
| `published` | boolean | Whether it appears on the QR menu |

### Modifier

A structured change attached to a menu item or an order item, such as “no chilli” or “more vinegar.”

| Field | Shape | Meaning |
| --- | --- | --- |
| `id` | UUID or null | Saved option ID; null for an approved free-text instruction |
| `name` | string | Human-readable instruction |
| `priceDeltaCents` | integer | Amount added to or removed from the unit price |

The server validates saved modifiers. Free-text instructions cannot change price.

### Order item

Represents a quantity of one menu item at the time of ordering.

| Field | Shape | Meaning |
| --- | --- | --- |
| `id` | UUID | Stable order-item identifier |
| `menuItemId` | UUID | Referenced menu item |
| `nameSnapshot` | string | Item name preserved for order history |
| `unitPriceCents` | non-negative integer | Validated price at order time |
| `quantity` | positive integer | Number ordered |
| `modifiers` | Modifier array | Validated selections/instructions |
| `lineTotalCents` | non-negative integer | Server-calculated line total |

### Order

Represents one customer order for one restaurant.

| Field | Shape | Meaning |
| --- | --- | --- |
| `id` | UUID | Stable internal identifier |
| `restaurantId` | UUID | Restaurant receiving the order |
| `displayNumber` | string | Short number shown to customer and kitchen |
| `source` | `qr`, `voice` or `demo` | How the draft began |
| `status` | Order status | Current workflow state |
| `items` | Order item array | Validated order lines |
| `subtotalCents` | non-negative integer | Sum before any future fees |
| `totalCents` | non-negative integer | Final server-calculated total |
| `currency` | `SGD` | Demo currency |
| `createdAt` | ISO timestamp | Creation time |

Do not collect customer identity or payment-card data for the hackathon unless a separately reviewed feature requires it.

## Order status

The single happy-path state machine is:

`received` → `paid` → `preparing` → `ready`

- Order creation produces `received`.
- Demo payment confirmation moves `received` to `paid`.
- An authorized restaurant member moves `paid` to `preparing`, then `preparing` to `ready`.
- The demo does not implement refunds, cancellation or real payment settlement unless both owners explicitly add those states to this contract.

## Interfaces between the two surfaces

### Photograph-menu onboarding

AI extraction returns menu-item drafts plus confidence or review warnings. It never publishes items automatically. Kimberley's review screen owns correction, approval and storefront preview.

### Voice ordering

Voice interpretation returns a draft order containing proposed item IDs, quantities, modifiers, confidence and unresolved phrases. Kimberley's ordering UI owns customer confirmation. The server validates availability, permitted modifiers and all prices before accepting the order.

### Customer QR ordering

Anonymous visitors can read only a published restaurant and its published, available menu. Order submission uses a validated server endpoint rather than broad anonymous table writes.

### Kitchen operations

The kitchen display receives only orders for restaurants its signed-in member can access. Realtime updates follow the shared order-status values exactly.

## Change rule

Changes to an object name, field meaning, money convention or order status require a small pull request updating this document before either surface relies on the change.
