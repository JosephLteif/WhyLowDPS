export interface OptionEntry {
  key: string;
  label: string;
  icon: string;
  token?: string;
  spellId?: number;
  itemId?: number;
  craftingQuality?: number;
}

export const EXTERNAL_BUFF_OPTIONS: OptionEntry[] = [
  {
    key: 'chaos_brand',
    label: 'Chaos Brand',
    spellId: 255260,
    icon: 'ability_demonhunter_chaosbrand',
  },
  {
    key: 'mystic_touch',
    label: 'Mystic Touch',
    spellId: 113746,
    icon: 'ability_monk_mystictouch',
  },
  {
    key: 'skyfury',
    label: 'Skyfury',
    spellId: 462854,
    icon: 'spell_shaman_skyfury',
  },
  {
    key: 'power_infusion',
    label: 'Power Infusion',
    spellId: 10060,
    icon: 'spell_holy_powerinfusion',
  },
  {
    key: 'blessing_of_bronze',
    label: 'Blessing of Bronze',
    spellId: 381748,
    icon: 'inv_evoker_bronzesigil',
  },
  {
    key: 'augmentation',
    label: 'Ebon Might (Aug)',
    spellId: 395152,
    icon: 'spell_evoker_ebonmight',
  },
];

export const RAID_BUFF_MATRIX_OPTIONS: OptionEntry[] = [
  { key: 'bloodlust', label: 'Bloodlust/Heroism', spellId: 2825, icon: 'spell_nature_bloodlust' },
  { key: 'arcane_intellect', label: 'Arcane Intellect', spellId: 1459, icon: 'spell_holy_magicalsentry' },
  { key: 'power_word_fortitude', label: 'Power Word: Fortitude', spellId: 21562, icon: 'spell_holy_wordfortitude' },
  { key: 'mark_of_the_wild', label: 'Mark of the Wild', spellId: 1126, icon: 'spell_nature_regeneration' },
  { key: 'battle_shout', label: 'Battle Shout', spellId: 6673, icon: 'ability_warrior_battleshout' },
  { key: 'mystic_touch', label: 'Mystic Touch (5% Physical Damage)', spellId: 113746, icon: 'ability_monk_mystictouch' },
  { key: 'chaos_brand', label: 'Chaos Brand (3% Magic Damage)', spellId: 255260, icon: 'ability_demonhunter_chaosbrand' },
  { key: 'skyfury', label: 'Skyfury', spellId: 462854, icon: 'spell_shaman_skyfury' },
  { key: 'hunters_mark', label: "Hunter's Mark", spellId: 257284, icon: 'ability_hunter_snipershot' },
  { key: 'power_infusion', label: 'Power Infusion (Beta)', spellId: 10060, icon: 'spell_holy_powerinfusion' },
  { key: 'bleeding', label: 'Bleeding Debuff', spellId: 703, icon: 'ability_rogue_rupture' },
];

export const FLASK_OPTIONS: OptionEntry[] = [
  { key: 'flask_of_the_shattered_sun_2', label: 'Shattered Sun (Crit) 2', token: 'flask_of_the_shattered_sun_2', icon: 'inv_12_profession_alchemy_flask_sindoreipotion_red__', itemId: 241326 },
  { key: 'flask_of_the_shattered_sun_1', label: 'Shattered Sun (Crit) 1', token: 'flask_of_the_shattered_sun_1', icon: 'inv_12_profession_alchemy_flask_sindoreipotion_red__', itemId: 241327 },
  { key: 'flask_of_the_blood_knights_2', label: 'Blood Knights (Haste) 2', token: 'flask_of_the_blood_knights_2', icon: 'inv_12_profession_alchemy_flask_sindoreipotion_white_', itemId: 241324 },
  { key: 'flask_of_the_blood_knights_1', label: 'Blood Knights (Haste) 1', token: 'flask_of_the_blood_knights_1', icon: 'inv_12_profession_alchemy_flask_sindoreipotion_white_', itemId: 241325 },
  { key: 'flask_of_the_magisters_2', label: 'Magisters (Mastery) 2', token: 'flask_of_the_magisters_2', icon: 'inv_12_profession_alchemy_flask_sindoreipotion_black', itemId: 241322 },
  { key: 'flask_of_the_magisters_1', label: 'Magisters (Mastery) 1', token: 'flask_of_the_magisters_1', icon: 'inv_12_profession_alchemy_flask_sindoreipotion_black', itemId: 241323 },
  { key: 'flask_of_thalassian_resistance_2', label: 'Thalassian Resistance (Vers) 2', token: 'flask_of_thalassian_resistance_2', icon: 'inv_12_profession_alchemy_flask_sindoreipotion_yellow', itemId: 241320 },
  { key: 'flask_of_thalassian_resistance_1', label: 'Thalassian Resistance (Vers) 1', token: 'flask_of_thalassian_resistance_1', icon: 'inv_12_profession_alchemy_flask_sindoreipotion_yellow', itemId: 241321 },
  { key: 'flask_of_alchemical_chaos_3', label: 'Alchemical Chaos 3', token: 'flask_of_alchemical_chaos_3', icon: 'inv_potion_orange', itemId: 212283 },
  { key: 'flask_of_alchemical_chaos_2', label: 'Alchemical Chaos 2', token: 'flask_of_alchemical_chaos_2', icon: 'inv_potion_orange', itemId: 212282 },
  { key: 'flask_of_alchemical_chaos_1', label: 'Alchemical Chaos 1', token: 'flask_of_alchemical_chaos_1', icon: 'inv_potion_orange', itemId: 212281 },
  { key: 'flask_of_tempered_mastery_3', label: 'Tempered Mastery 3', token: 'flask_of_tempered_mastery_3', icon: 'inv_potion_purlple', itemId: 212280 },
  { key: 'flask_of_tempered_mastery_2', label: 'Tempered Mastery 2', token: 'flask_of_tempered_mastery_2', icon: 'inv_potion_purlple', itemId: 212279 },
  { key: 'flask_of_tempered_mastery_1', label: 'Tempered Mastery 1', token: 'flask_of_tempered_mastery_1', icon: 'inv_potion_purlple', itemId: 212278 },
  { key: 'flask_of_tempered_swiftness_3', label: 'Tempered Swiftness 3', token: 'flask_of_tempered_swiftness_3', icon: 'inv_potion_green', itemId: 212274 },
  { key: 'flask_of_tempered_swiftness_2', label: 'Tempered Swiftness 2', token: 'flask_of_tempered_swiftness_2', icon: 'inv_potion_green', itemId: 212273 },
  { key: 'flask_of_tempered_swiftness_1', label: 'Tempered Swiftness 1', token: 'flask_of_tempered_swiftness_1', icon: 'inv_potion_green', itemId: 212272 },
  { key: 'flask_of_tempered_versatility_3', label: 'Tempered Versatility 3', token: 'flask_of_tempered_versatility_3', icon: 'inv_potion_blue', itemId: 212277 },
  { key: 'flask_of_tempered_versatility_2', label: 'Tempered Versatility 2', token: 'flask_of_tempered_versatility_2', icon: 'inv_potion_blue', itemId: 212276 },
  { key: 'flask_of_tempered_versatility_1', label: 'Tempered Versatility 1', token: 'flask_of_tempered_versatility_1', icon: 'inv_potion_blue', itemId: 212275 },
  { key: 'flask_of_tempered_aggression_3', label: 'Tempered Aggression 3', token: 'flask_of_tempered_aggression_3', icon: 'inv_potion_red', itemId: 212271 },
  { key: 'flask_of_tempered_aggression_2', label: 'Tempered Aggression 2', token: 'flask_of_tempered_aggression_2', icon: 'inv_potion_red', itemId: 212270 },
  { key: 'flask_of_tempered_aggression_1', label: 'Tempered Aggression 1', token: 'flask_of_tempered_aggression_1', icon: 'inv_potion_red', itemId: 212269 },
];

export const FOOD_OPTIONS: OptionEntry[] = [
  { key: 'silvermoon_parade', label: 'Silvermoon Parade', token: 'silvermoon_parade', icon: 'inv_tradeskill_cooking_feastofblood', itemId: 255845 },
  { key: 'queldorei_medley', label: "Quel'dorei Medley", token: 'queldorei_medley', icon: 'inv_cooking_10_draconicdelicacies', itemId: 242272 },
  { key: 'blooming_feast', label: 'Blooming Feast', token: 'blooming_feast', icon: 'inv_misc_food_cooked_greatpabanquet_wok', itemId: 242273 },
  { key: 'harandar_celebration', label: 'Harandar Celebration', token: 'harandar_celebration', icon: 'inv_misc_1h_soup_b_01_misc_1h_soup_b_01', itemId: 255846 },
  { key: 'royal_roast', label: 'Royal Roast', token: 'royal_roast', icon: 'inv_cooking_100_roastduck', itemId: 242275 },
  { key: 'impossibly_royal_roast', label: 'Impossibly Royal Roast', token: 'impossibly_royal_roast', icon: 'inv_cooking_100_roastduck', itemId: 255847 },
  { key: 'flora_frenzy', label: 'Flora Frenzy', token: 'flora_frenzy', icon: 'inv_cooking_100_sidesalad_color04', itemId: 255848 },
  { key: 'champions_bento', label: "Champion's Bento", token: 'champions_bento', icon: 'inv_misc_food_vendor_poundedricecake_1', itemId: 242274 },
  { key: 'warped_wise_wings', label: 'Warped Wise Wings', token: 'warped_wise_wings', icon: 'inv_cooking_10_grandbanquet', itemId: 242285 },
  { key: 'voidkissed_fish_rolls', label: 'Void-Kissed Fish Rolls', token: 'voidkissed_fish_rolls', icon: 'inv_cooking_80_ravenberrytart', itemId: 242284 },
  { key: 'sunseared_lumifin', label: 'Sun-Seared Lumifin', token: 'sunseared_lumifin', icon: 'inv_misc_food_cooked_wildfowlroast', itemId: 242283 },
  { key: 'null_and_void_plate', label: 'Null and Void Plate', token: 'null_and_void_plate', icon: 'inv_misc_food_draenor_saltedskulker_color01', itemId: 242282 },
  { key: 'glitter_skewers', label: 'Glitter Skewers', token: 'glitter_skewers', icon: 'inv_misc_food_160_fish_87', itemId: 242281 },
  { key: 'felkissed_filet', label: 'Fel-Kissed Filet', token: 'felkissed_filet', icon: 'inv_cooking_100_revengeservedcold_color02', itemId: 242286 },
  { key: 'buttered_root_crab', label: 'Buttered Root Crab', token: 'buttered_root_crab', icon: 'inv_misc_food_draenor_steamedscorpion', itemId: 242280 },
  { key: 'arcano_cutlets', label: 'Arcano Cutlets', token: 'arcano_cutlets', icon: 'inv_cooking_81_paleosteakandpotatoes_color04', itemId: 242287 },
  { key: 'tasty_smoked_tetra', label: 'Tasty Smoked Tetra', token: 'tasty_smoked_tetra', icon: 'inv_cooking_100_revengeservedcold', itemId: 242278 },
  { key: 'crimson_calamari', label: 'Crimson Calamari', token: 'crimson_calamari', icon: 'inv_misc_food_cooked_valleystirfry', itemId: 242277 },
  { key: 'braised_blood_hunter', label: 'Braised Blood Hunter', token: 'braised_blood_hunter', icon: 'inv_misc_food_legion_fishbrulspecial', itemId: 242276 },
  { key: 'authentic_undermine_clam_chowder', label: 'Authentic Undermine Clam Chowder', token: 'authentic_undermine_clam_chowder', icon: 'inv_drink_17', itemId: 235805 },
  { key: 'feast_of_the_midnight_masquerade', label: 'Feast of the Midnight Masquerade', token: 'feast_of_the_midnight_masquerade', icon: 'inv_11_cooking_profession_feast_table02', itemId: 222733 },
  { key: 'feast_of_the_divine_day', label: 'Feast of the Divine Day', token: 'feast_of_the_divine_day', icon: 'inv_11_cooking_profession_feast_table01', itemId: 222732 },
  { key: 'the_sushi_special', label: 'The Sushi Special', token: 'the_sushi_special', icon: 'inv_tradeskill_cooking_feastofthewater', itemId: 222720 },
  { key: 'everything_stew', label: 'Everything Stew', token: 'everything_stew', icon: 'inv_cooking_10_draconicdelicacies', itemId: 222735 },
  { key: 'beledars_bounty', label: "Beledar's Bounty", token: 'beledars_bounty', icon: 'inv_cooking_100_roastduck_color02', itemId: 222728 },
  { key: 'empress_farewell', label: "Empress' Farewell", token: 'empress_farewell', icon: 'inv_misc_food_meat_cooked_02_color02', itemId: 222729 },
  { key: 'jesters_board', label: "Jester's Board", token: 'jesters_board', icon: 'inv_misc_food_meat_cooked_06', itemId: 222730 },
  { key: 'outsiders_provisions', label: "Outsider's Provisions", token: 'outsiders_provisions', icon: 'inv_cooking_10_draconicdelicacies', itemId: 222731 },
  { key: 'anglers_delight', label: "Angler's Delight", token: 'anglers_delight', icon: 'inv_cooking_100_revengeservedcold_color04', itemId: 222727 },
  { key: 'mycobloom_risotto', label: 'Mycobloom Risotto', token: 'mycobloom_risotto', icon: 'inv_cooking_80_sailorspie', itemId: 222725 },
  { key: 'sizzling_honey_roast', label: 'Sizzling Honey Roast', token: 'sizzling_honey_roast', icon: 'inv_cooking_100_roastduck', itemId: 222724 },
  { key: 'stuffed_cave_peppers', label: 'Stuffed Cave Peppers', token: 'stuffed_cave_peppers', icon: 'inv_cooking_90_smuggledproduce', itemId: 222723 },
  { key: 'chippy_tea', label: 'Chippy Tea', token: 'chippy_tea', icon: 'inv_misc_food_vendor_roastedbarlytea', itemId: 222736 },
  { key: 'deepfin_patty', label: 'Deepfin Patty', token: 'deepfin_patty', icon: 'inv_misc_food_vendor_poundedricecakes', itemId: 222718 },
  { key: 'fiery_fish_sticks', label: 'Fiery Fish Sticks', token: 'fiery_fish_sticks', icon: 'inv_misc_fish_18', itemId: 222715 },
  { key: 'fish_and_chips', label: 'Fish and Chips', token: 'fish_and_chips', icon: 'inv_cooking_80_swampfishnchips', itemId: 222721 },
  { key: 'gingerglazed_fillet', label: 'Ginger-Glazed Fillet', token: 'gingerglazed_fillet', icon: 'inv_cooking_82_moistfillet', itemId: 222716 },
  { key: 'marinated_tenderloins', label: 'Marinated Tenderloins', token: 'marinated_tenderloins', icon: 'inv_misc_food_meat_cooked_02', itemId: 222723 },
  { key: 'salt_baked_seafood', label: 'Salt Baked Seafood', token: 'salt_baked_seafood', icon: 'inv_misc_food_draenor_saltedskulker', itemId: 222722 },
  { key: 'salty_dog', label: 'Salty Dog', token: 'salty_dog', icon: 'inv_cooking_81_honeypotpie', itemId: 222717 },
  { key: 'sweet_and_spicy_soup', label: 'Sweet and Spicy Soup', token: 'sweet_and_spicy_soup', icon: 'inv_misc_food_vendor_tangypeachyogurt', itemId: 222719 },
  { key: 'zesty_nibblers', label: 'Zesty Nibblers', token: 'zesty_nibblers', icon: 'inv_misc_food_86_basilisk', itemId: 222714 },
];

export const POTION_OPTIONS: OptionEntry[] = [
  { key: 'lights_potential_2', label: "Light's Potential 2", token: 'lights_potential_2', icon: 'inv_12_profession_alchemy_lightpotion_yellow', itemId: 241308 },
  { key: 'lights_potential_1', label: "Light's Potential 1", token: 'lights_potential_1', icon: 'inv_12_profession_alchemy_lightpotion_yellow', itemId: 241309 },
  { key: 'potion_of_zealotry_2', label: 'Potion of Zealotry 2', token: 'potion_of_zealotry_2', icon: 'inv_12_profession_alchemy_lightpotion_green', itemId: 241296 },
  { key: 'potion_of_zealotry_1', label: 'Potion of Zealotry 1', token: 'potion_of_zealotry_1', icon: 'inv_12_profession_alchemy_lightpotion_green', itemId: 241297 },
  { key: 'potion_of_recklessness_2', label: 'Potion of Recklessness 2', token: 'potion_of_recklessness_2', icon: 'inv_12_profession_alchemy_voidpotion_red', itemId: 241288 },
  { key: 'potion_of_recklessness_1', label: 'Potion of Recklessness 1', token: 'potion_of_recklessness_1', icon: 'inv_12_profession_alchemy_voidpotion_red', itemId: 241289 },
  { key: 'draught_of_rampant_abandon_2', label: 'Draught of Rampant Abandon 2', token: 'draught_of_rampant_abandon_2', icon: 'inv_12_profession_alchemy_voidpotion_purple', itemId: 241292 },
  { key: 'draught_of_rampant_abandon_1', label: 'Draught of Rampant Abandon 1', token: 'draught_of_rampant_abandon_1', icon: 'inv_12_profession_alchemy_voidpotion_purple', itemId: 241293 },
  { key: 'tempered_potion_3', label: 'Tempered 3', token: 'tempered_potion_3', icon: 'trade_alchemy_potiona4', itemId: 212265 },
  { key: 'tempered_potion_2', label: 'Tempered 2', token: 'tempered_potion_2', icon: 'trade_alchemy_potiona4', itemId: 212264 },
  { key: 'tempered_potion_1', label: 'Tempered 1', token: 'tempered_potion_1', icon: 'trade_alchemy_potiona4', itemId: 212263 },
  { key: 'potion_of_unwavering_focus_3', label: 'Unwavering Focus 3', token: 'potion_of_unwavering_focus_3', icon: 'inv_potion_16', itemId: 212259 },
  { key: 'potion_of_unwavering_focus_2', label: 'Unwavering Focus 2', token: 'potion_of_unwavering_focus_2', icon: 'inv_potion_16', itemId: 212258 },
  { key: 'potion_of_unwavering_focus_1', label: 'Unwavering Focus 1', token: 'potion_of_unwavering_focus_1', icon: 'inv_potion_16', itemId: 212257 },
];

export const AUGMENT_RUNE_OPTIONS: OptionEntry[] = [
  { key: 'void_touched', label: 'Void-Touched', token: 'void_touched', icon: 'inv_10_enchanting_crystal_color2', itemId: 259085 },
  { key: 'crystallized', label: 'Crystallized', token: 'crystallized', icon: 'inv_10_enchanting_crystal_color5', itemId: 224572 },
];

export const TEMP_ENCHANT_OPTIONS: OptionEntry[] = [
  { key: 'main_hand_refulgent_whetstone_2', label: 'AP (Sharp) 2', token: 'main_hand:refulgent_whetstone_2', icon: 'inv_12_profession_blacksmithing_whetstones_silver', itemId: 237371 },
  { key: 'main_hand_refulgent_whetstone_1', label: 'AP (Sharp) 1', token: 'main_hand:refulgent_whetstone_1', icon: 'inv_12_profession_blacksmithing_whetstones_green', itemId: 237370 },
  { key: 'main_hand_refulgent_weightstone_2', label: 'AP (Blunt) 2', token: 'main_hand:refulgent_weightstone_2', icon: 'inv_12_profession_blacksmithing_weightstone_silver', itemId: 237369 },
  { key: 'main_hand_refulgent_weightstone_1', label: 'AP (Blunt) 1', token: 'main_hand:refulgent_weightstone_1', icon: 'inv_12_profession_blacksmithing_weightstone_green', itemId: 237367 },
  { key: 'main_hand_thalassian_phoenix_oil_2', label: 'Phoenix Oil (Crit/Haste) 2', token: 'main_hand:thalassian_phoenix_oil_2', icon: 'inv_12_profession_enchanting_manaoil_red', itemId: 243734 },
  { key: 'main_hand_thalassian_phoenix_oil_1', label: 'Phoenix Oil (Crit/Haste) 1', token: 'main_hand:thalassian_phoenix_oil_1', icon: 'inv_12_profession_enchanting_manaoil_red', itemId: 243733 },
  { key: 'main_hand_oil_of_dawn_2', label: 'Oil of Dawn (Holy Damage) 2', token: 'main_hand:oil_of_dawn_2', icon: 'inv_12_profession_enchanting_manaoil_orange', itemId: 243736 },
  { key: 'main_hand_oil_of_dawn_1', label: 'Oil of Dawn (Holy Damage) 1', token: 'main_hand:oil_of_dawn_1', icon: 'inv_12_profession_enchanting_manaoil_orange', itemId: 243735 },
  { key: 'main_hand_smugglers_enchanted_edge_2', label: 'Enchanted Edge (Damage) 2', token: 'main_hand:smugglers_enchanted_edge_2', icon: 'inv_12_profession_enchanting_manaoil_purple', itemId: 243738 },
  { key: 'main_hand_smugglers_enchanted_edge_1', label: 'Enchanted Edge (Damage) 1', token: 'main_hand:smugglers_enchanted_edge_1', icon: 'inv_12_profession_enchanting_manaoil_purple', itemId: 243737 },
  { key: 'main_hand_laced_zoomshots_2', label: 'Zoomshots (Haste) 2', token: 'main_hand:laced_zoomshots_2', icon: 'inv_ammo_bullet_06', itemId: 257750 },
  { key: 'main_hand_laced_zoomshots_1', label: 'Zoomshots (Haste) 1', token: 'main_hand:laced_zoomshots_1', icon: 'inv_ammo_bullet_06', itemId: 257749 },
  { key: 'main_hand_weighted_boomshots_2', label: 'Boomshots (Damage) 2', token: 'main_hand:weighted_boomshots_2', icon: 'inv_ammo_bullet_05', itemId: 257752 },
  { key: 'main_hand_weighted_boomshots_1', label: 'Boomshots (Damage) 1', token: 'main_hand:weighted_boomshots_1', icon: 'inv_ammo_bullet_05', itemId: 257751 },
  { key: 'main_hand_ironclaw_whetstone_3', label: 'AP 3', token: 'main_hand:ironclaw_whetstone_3', icon: 'inv_blacksmithing_modifiedcraftingreagent_blue', itemId: 222504 },
  { key: 'main_hand_ironclaw_whetstone_2', label: 'AP 2', token: 'main_hand:ironclaw_whetstone_2', icon: 'inv_blacksmithing_modifiedcraftingreagent_blue', itemId: 222503 },
  { key: 'main_hand_ironclaw_whetstone_1', label: 'AP 1', token: 'main_hand:ironclaw_whetstone_1', icon: 'inv_blacksmithing_modifiedcraftingreagent_blue', itemId: 222502 },
  { key: 'main_hand_oil_of_deep_toxins_3', label: 'Deep Toxins (Damage) 3', token: 'main_hand:oil_of_deep_toxins_3', icon: 'trade_alchemy_potiond6', itemId: 224113 },
  { key: 'main_hand_oil_of_deep_toxins_2', label: 'Deep Toxins (Damage) 2', token: 'main_hand:oil_of_deep_toxins_2', icon: 'trade_alchemy_potiond6', itemId: 224112 },
  { key: 'main_hand_oil_of_deep_toxins_1', label: 'Deep Toxins (Damage) 1', token: 'main_hand:oil_of_deep_toxins_1', icon: 'trade_alchemy_potiond6', itemId: 224111 },
  { key: 'main_hand_algari_mana_oil_3', label: 'Mana Oil (Crit/Haste) 3', token: 'main_hand:algari_mana_oil_3', icon: 'trade_alchemy_potiond1', itemId: 224107 },
  { key: 'main_hand_algari_mana_oil_2', label: 'Mana Oil (Crit/Haste) 2', token: 'main_hand:algari_mana_oil_2', icon: 'trade_alchemy_potiond1', itemId: 224106 },
  { key: 'main_hand_algari_mana_oil_1', label: 'Mana Oil (Crit/Haste) 1', token: 'main_hand:algari_mana_oil_1', icon: 'trade_alchemy_potiond1', itemId: 224105 },
];
