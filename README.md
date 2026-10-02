One-time scene setup
Tag terrain. Open the scene, go to the Regions layer, draw a region over the forest/water/wall/etc., select it, then click the Tag Terrain tool (mountain-sun icon, GM only). Pick a terrain type from the dialog. Terrain is read from regions — untagged map art does nothing.
Drop tokens for your units. Set each token's Disposition (Friendly/Hostile/Neutral) correctly; the phase system keys status countdown off disposition, not off who owns the token.
Start a Combat Encounter with all those tokens in the tracker. Turn, status and charge automation only runs while a combat exists.
Per-turn use
Select your token, then open the action menu any of these ways:

Trigger	Notes
Q	Default keybind, rebindable in Configure Controls
⚡ on the token HUD	Right-click token → bolt icon, left column
/hol or /actions in chat	Same window
The menu (actionMenu.ts) shows HP, status, terrain + its movement cost, Charge, Move, equipped weapon, traits, and your current target's distance. Buttons:

Attack — needs exactly one target. Greyed out with a reason if you have no weapon, are out of range, or
are holding a staff without Wrathful Staff.
Use Item — one button per consumable in your inventory, showing remaining uses.
Staff Effect — staff users only.
Transform / Untransform — shifters only.
Rescue — enabled only when your Aid exceeds the target's Con.
Wait, Open Sheet.
The menu live-refreshes when you change targets, so you can retarget without reopening it.

Attacking
Target an enemy (press T over their token), then Attack in the menu, or press E, or type /attack. That opens the Combat Forecast (forecast.ts) — a Fire Emblem style side-by-side showing damage, number of strikes, hit %, crit %, advantage/disadvantage, weapon triangle, effectiveness, the strike order, and the speed difference. There's a weapon dropdown that re-equips
and recomputes on the fly.

Click Fight and the system rolls the whole exchange as one dice pool, applies HP, statuses and Charge to both actors, and posts a combat card to chat.

What it does for you vs. what you still do
Automated: hit rolls vs Avoid (ties to defender), advantage/disadvantage thresholds, crits vs Critical Avoid, follow-ups at 4+ Speed, Vantage/Desperation ordering, weapon triangle Hit and Tri, effective-damage tripling (and the Shield skills that negate it), post-combat damage, status infliction from refines, Charge gain, terrain Avoid/Def, and support bonuses when partners are within 2 tiles.

Still manual: moving tokens (movement cost is reported as a notification, and the system only blocks moves into impassable ground), choosing which Combat Arts to
spend Charge on, rescue positioning, and anything narrative.

Phase bookkeeping
On each turn change the system runs runPhaseStart (actions.ts:180): terrain HP gain/loss, poison damage, Gauge decay for transformed units, status cures from Magic Veins, and KO handling — then posts a summary line to chat. When the disposition changes between combatants, statuses inflicted by that side tick down. Deleting the combat clears tonics and resets Charge, per the end-of-map rules.
