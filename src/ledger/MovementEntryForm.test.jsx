import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MovementEntryForm } from './MovementEntryForm.jsx'
import { MOVEMENT_ENTRY_STEPS, movementTypeOptions } from './movementConfig.js'
import { movementOptionGroups } from './ledgerUiConfig.js'

describe('movement catalog', () => {
  it('places every selectable movement in exactly one visible group', () => {
    const configuredTypes = movementOptionGroups.flatMap((group) => group.types)
    expect(configuredTypes).toHaveLength(movementTypeOptions.length)
    expect(new Set(configuredTypes).size).toBe(configuredTypes.length)
    expect(new Set(configuredTypes)).toEqual(new Set(movementTypeOptions.map((option) => option.type)))
  })

  it('shows every action and its purpose without a collapsed menu', () => {
    const html = renderToStaticMarkup(
      <MovementEntryForm
        activeEntryMode="movement"
        currentMovementStepCopy={{ title: 'نوع الحركة' }}
        currentMovementStepIndex={0}
        visibleMovementSteps={[MOVEMENT_ENTRY_STEPS.TYPE]}
        completedMovementReceipt={[]}
        movementStep={MOVEMENT_ENTRY_STEPS.TYPE}
        movementDraft={{ type: movementTypeOptions[0].type }}
        movementConfig={{}}
        hasChosenMovementType={false}
        canReviewMovement={false}
        chooseMovementType={() => {}}
      />,
    )

    expect(html).not.toContain('<details')
    expect(html.match(/class="ml3-action-choice /g)).toHaveLength(movementTypeOptions.length)
    for (const option of movementTypeOptions) {
      expect(html).toContain(option.detail)
    }
  })
})
