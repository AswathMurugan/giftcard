# Nucleo icon catalog

Curated friendly-name -> glyph-class map for the vendored Nucleo font
(457 icons). Every class below is verified to exist in
`nucleo.css`. Usage (the agent writes the className directly):

```tsx
<i className="icon icon_-Tb_wallet text-[1.125rem]" aria-hidden="true" />
```

Sizes: `text-[1.125rem]` (18px) inline / `text-[1.25rem]` (20px) in buttons,
alerts, and icon-in-a-circle tiles (a Nucleo glyph fills ~80% of its em box,
so size up vs. a lucide SVG). Use rem, not px, so icons scale with text.

**Not here?** Grep before guessing — a wrong class renders blank, silently:
```sh
grep -oE "icon_-Tb_<keyword>[a-z0-9_]*" src/assets/fonts/nucleo/nucleo.css | sort -u
```
Only fall back to `lucide-react` if grep finds nothing suitable.

## Finance & money

| Name | Class |
|---|---|
| adjustments-dollar | `icon_-Tb_adjustments_dollar` |
| arrows-exchange | `icon_-Tb_arrows_exchange` |
| arrows-transfer-down | `icon_-Tb_arrows_transfer_down` |
| arrows-transfer-up | `icon_-Tb_arrows_transfer_up` |
| asset | `icon_-Tb_asset` |
| bank | `icon_-Tb_building_bank` |
| brand-cashapp | `icon_-Tb_brand_cashapp` |
| briefcase | `icon_-Tb_briefcase` |
| briefcase-portfolio | `icon_-Bd_Briefcase_Portfolio` |
| building-bank | `icon_-Tb_building_bank` |
| card | `icon_-Bd_Card` |
| card-collection | `icon_-Bd_Card_Collection` |
| cards | `icon_-Tb_cards` |
| cash | `icon_-Tb_cash` |
| cash-banknote | `icon_-Tb_cash_banknote` |
| cash-money | `icon_-Bd_Cash_Money` |
| coin | `icon_-Tb_coin` |
| coins | `icon_-Tb_coins` |
| credit-card | `icon_-Tb_credit_card` |
| credit-card-pay | `icon_-Tb_credit_card_pay` |
| currency | `icon_-Tb_currency` |
| currency-bitcoin | `icon_-Tb_currency_bitcoin` |
| currency-dollar | `icon_-Tb_currency_dollar` |
| currency-euro | `icon_-Tb_currency_euro` |
| currency-pound | `icon_-Tb_currency_pound` |
| currency-rupee | `icon_-Tb_currency_rupee` |
| currency-yen | `icon_-Tb_currency_yen` |
| device-ipad-horizontal-dollar | `icon_-Tb_device_ipad_horizontal_dollar` |
| diamond | `icon_-Tb_diamond` |
| diamond-bold | `icon_-Bd_Diamond` |
| discount | `icon_-Tb_discount` |
| dollar | `icon_-Bd_Dollar` |
| dollar-sign | `icon_-Tb_currency_dollar` |
| exchange | `icon_-Tb_exchange` |
| exchange-transfer | `icon_-Bd_Exchange_Transfer` |
| file-invoice | `icon_-Tb_file_invoice` |
| growth | `icon_-Tb_growth` |
| layout-cards | `icon_-Tb_layout_cards` |
| moneybag | `icon_-Tb_moneybag` |
| percent | `icon_-Tb_percentage` |
| percentage | `icon_-Tb_percentage` |
| pig-money | `icon_-Tb_pig_money` |
| receipt | `icon_-Tb_receipt` |
| receipt-tax | `icon_-Tb_receipt_tax` |
| report-money | `icon_-Tb_report_money` |
| transfer | `icon_-Tb_transfer` |
| transfer-in | `icon_-Tb_transfer_in` |
| transfer-out | `icon_-Tb_transfer_out` |
| user-dollar | `icon_-Tb_user_dollar` |
| wallet | `icon_-Tb_wallet` |
| zoom-money | `icon_-Tb_zoom_money` |

## Charts & data

| Name | Class |
|---|---|
| analytics | `icon_-Tb_chart_bar` |
| analytics-bold | `icon_-Bd_Chart_bar` |
| binary | `icon_-Tb_binary` |
| cell | `icon_-Tb_cell` |
| chart-bar | `icon_-Tb_chart_bar` |
| chart-column | `icon_-Tb_chart_arrows_vertical` |
| chart-donut | `icon_-Tb_chart_donut` |
| chart-dots | `icon_-Tb_chart_dots` |
| chart-line | `icon_-Tb_chart_line` |
| chart-pie | `icon_-Tb_chart_pie` |
| database | `icon_-Bd_Database` |
| database-export | `icon_-Tb_database_export` |
| database-import | `icon_-Tb_database_import` |
| database-search | `icon_-Tb_database_search` |
| global_variable | `icon_-Tb_GlobalVariable` |
| hash | `icon_-Tb_hash` |
| hierarchy | `icon_-Tb_hierarchy` |
| hierarchy_2 | `icon_-Tb_hierarchy_2` |
| hierarchy_3 | `icon_-Tb_hierarchy_3` |
| list_details | `icon_-Tb_list_details` |
| math_function | `icon_-Tb_math_function` |
| math_integral_x | `icon_-Tb_math_integral_x` |
| sitemap | `icon_-Tb_sitemap` |
| sum | `icon_-Tb_sum` |
| table | `icon_-Tb_table` |
| table-column | `icon_-Tb_table_column` |
| table-export | `icon_-Tb_table_export` |
| table-import | `icon_-Tb_table_import` |
| table-row | `icon_-Tb_table_row` |
| topology_full_hierarchy | `icon_-Tb_topology_full_hierarchy` |
| topology_ring | `icon_-Tb_topology_ring` |
| topology_ring_2 | `icon_-Tb_topology_ring_2` |
| topology_ring_3 | `icon_-Tb_topology_ring_3` |
| topology-full | `icon_-Tb_topology_full_hierarchy` |
| variable | `icon_-Tb_variable` |

## Users & people

| Name | Class |
|---|---|
| account-circle | `icon_-Bd_account_circle` |
| forbid | `icon_-Tb_forbid` |
| grid | `icon_-Bd_Grid_Feed_Cards` |
| id | `icon_-Tb_id` |
| layout-grid | `icon_-Tb_layout_grid` |
| line-solid | `icon_-Tb_line` |
| team | `icon_-Tb_users_group` |
| team-bold | `icon_-Bd_Three_People` |
| three-people | `icon_-Bd_Three_People` |
| user | `icon_-Tb_user` |
| user-bolt | `icon_-Tb_user_bolt` |
| user-check | `icon_-Tb_user_check` |
| user-line | `icon_-Ax_user` |
| users | `icon_-Tb_users` |

## Navigation & layout

| Name | Class |
|---|---|
| app_window | `icon_-Tb_app_window` |
| apps | `icon_-Tb_box` |
| apps_alt | `icon_-Tb_apps` |
| apps-bold | `icon_-Bd_Box` |
| arrows_left_right | `icon_-Tb_arrows_left_right` |
| arrows_maximize | `icon_-Tb_arrows_maximize` |
| arrows_right_left | `icon_-Tb_arrows_right_left` |
| arrows_split | `icon_-Tb_arrows_split` |
| arrows_split_2 | `icon_-Tb_arrows_split_2` |
| arrows-diagonal | `icon_-Tb_arrows_diagonal` |
| arrows-diagonal-minimize | `icon_-Tb_arrows_diagonal_minimize_2` |
| arrows-horizontal | `icon_-Tb_arrows_horizontal` |
| arrows-maximize | `icon_-Tb_arrows_maximize` |
| arrows-minimize | `icon_-Tb_arrows_minimize` |
| browser | `icon_-Tb_browser` |
| columns | `icon_-Tb_columns` |
| dashboard | `icon_-Tb_dashboard` |
| dashboard-bold | `icon_-Bd_Layout` |
| docktoright | `icon_-Bd_DockToRight` |
| expand | `icon_-Bd_Expand` |
| expandpanel | `icon_-Bd_ExpandPanel` |
| file_stack | `icon_-Tb_file_stack` |
| hamburger-menu | `icon_-Bd_Hamburger_Menu` |
| home | `icon_-Tb_home` |
| home-bold | `icon_-Bd_Home` |
| home-line | `icon_-Ax_home` |
| layout-columns | `icon_-Tb_layout_columns` |
| layout-dashboard | `icon_-Tb_layout_dashboard` |
| layout-distribute-vertical | `icon_-Tb_layout_distribute_vertical` |
| layout-navbar-collapse | `icon_-Tb_layout_navbar_collapse` |
| layout-navbar-expand | `icon_-Tb_layout_navbar_expand` |
| layout-rows | `icon_-Tb_layout_rows` |
| layout-sidebar-left-collapse | `icon_-Tb_layout_sidebar_left_collapse` |
| maximize | `icon_-Tb_maximize` |
| menu | `icon_-Tb_layout_sidebar_left_collapse` |
| menu-collapsed | `icon_-Tb_layout_sidebar_left_collapse` |
| menu-expanded | `icon_-Tb_layout_sidebar_left_collapse` |
| menu-left | `icon_-Bd_Menu_left` |
| menu-right | `icon_-Bd_Menu_right` |
| square | `icon_-Tb_square` |
| square_dot | `icon_-Tb_square_dot` |
| square_plus | `icon_-Tb_square_plus` |
| square-check | `icon_-Tb_square_check` |
| square-letter-d | `icon_-Tb_square_letter_d` |
| square-letter-f | `icon_-Tb_square_letter_f` |
| square-letter-t | `icon_-Tb_square_letter_t` |
| square-rounded | `icon_-Tb_square_rounded` |
| squares_filled | `icon_-Tb_squares_filled` |
| stack | `icon_-Tb_stack` |
| tb_layout_sidebar_left_collapse | `icon_-Tb_layout_sidebar_left_collapse` |
| undock | `icon_-Bd_unDock` |
| window_minimize | `icon_-Tb_window_minimize` |

## Arrows & chevrons

| Name | Class |
|---|---|
| arrow_autofit_content | `icon_-Tb_arrow_autofit_content` |
| arrow_caret_down | `icon_-Bd_Arrow_Caret_Down` |
| arrow_caret_forward | `icon_-Bd_Arrow_Caret_Forward` |
| arrow_chevron_back | `icon_-Bd_Arrow_Chevron_Back` |
| arrow_chevron_down | `icon_-Bd_Arrow_Chevron_Down` |
| arrow_chevron_forward | `icon_-Bd_Arrow_Chevron_Forward` |
| arrow_chevron_left_circle | `icon_-Bd_Arrow_Chevron_Left_Circle` |
| arrow_chevron_right_circle | `icon_-Bd_Arrow_Chevron_Right_Circle` |
| arrow_chevron_up | `icon_-Bd_Arrow_Chevron_Up` |
| arrow_right_bar | `icon_-Tb_arrow_right_bar` |
| arrow-autofit-height | `icon_-Tb_arrow_autofit_height` |
| arrow-autofit-width | `icon_-Tb_arrow_autofit_width` |
| arrow-back-up | `icon_-Tb_arrow_back_up` |
| arrow-big-up-lines | `icon_-Tb_arrow_big_up_lines` |
| arrow-chevron-left-circle | `icon_-Bd_Arrow_Chevron_Left_Circle` |
| arrow-chevron-right-circle | `icon_-Bd_Arrow_Chevron_Right_Circle` |
| arrow-connect-outline | `icon_-Tb_arrow_connect_outline` |
| arrow-down | `icon_-Tb_arrow_down` |
| arrow-forward | `icon_-Tb_arrow_forward` |
| arrow-forward-up | `icon_-Tb_arrow_forward_up` |
| arrow-left | `icon_-Tb_arrow_left` |
| arrow-left-right | `icon_-Tb_arrow_left_right` |
| arrow-narrow-right | `icon_-Tb_arrow_narrow_right` |
| arrow-right | `icon_-Tb_arrow_right` |
| arrow-up | `icon_-Tb_arrow_up` |
| back_arrow | `icon_-Bd_Back_Arrow` |
| chevron-down | `icon_-Tb_chevron_down` |
| chevron-left | `icon_-Tb_chevron_left` |
| chevron-right | `icon_-Tb_chevron_right` |
| chevron-up | `icon_-Tb_chevron_up` |
| chevrons-left | `icon_-Tb_chevrons_left` |
| chevrons-right | `icon_-Tb_chevrons_right` |
| column-move-left | `icon_-Tb_column_move_left` |
| column-move-right | `icon_-Tb_column_move_right` |
| corner_left_up | `icon_-Tb_corner_left_up` |
| fallback | `icon_-Tb_alert_circle` |
| hand_move | `icon_-Tb_hand_move` |
| mail_forward | `icon_-Tb_mail_forward` |
| player_skip_forward | `icon_-Tb_player_skip_forward` |
| remove-duplicate | `icon_-Tb_remove_duplicate` |
| sort-ascending | `icon_-Tb_sort_ascending` |
| sort-descending | `icon_-Tb_sort_descending` |

## Files & folders

| Name | Class |
|---|---|
| article | `icon_-Tb_article` |
| clipboard | `icon_-Tb_clipboard` |
| clipboard-list | `icon_-Tb_clipboard_list` |
| clipboard-text | `icon_-Tb_clipboard_text` |
| doc_generate | `icon_-Tb_doc_generate` |
| doc_operations | `icon_-Tb_doc_operations` |
| file | `icon_-Tb_file` |
| file_bold | `icon_-Bd_File` |
| file_download | `icon_-Tb_file_download` |
| file_export | `icon_-Tb_file_export` |
| file_search | `icon_-Tb_file_search` |
| file_settings | `icon_-Tb_file_settings` |
| file_x | `icon_-Tb_file_x` |
| file_zip | `icon_-Tb_file_zip` |
| file-plus | `icon_-Tb_file_plus` |
| file-search | `icon_-Tb_file_search` |
| file-settings | `icon_-Tb_file_settings` |
| file-specification | `icon_-Tb_file_specification` |
| file-text | `icon_-Tb_file_text` |
| file-text-ai | `icon_-Tb_file_text_ai` |
| files | `icon_-Tb_files` |
| folder | `icon_-Tb_folder` |
| folder_share | `icon_-Tb_folder_share` |
| folder_x | `icon_-Tb_folder_x` |
| license | `icon_-Tb_license` |
| news | `icon_-Tb_news` |
| notebook | `icon_-Tb_notebook` |
| notes | `icon_-Tb_notes` |
| paperclip | `icon_-Tb_paperclip` |
| photo | `icon_-Tb_photo` |
| photo-ai | `icon_-Tb_photo_ai` |
| tb_clipboard_text | `icon_-Tb_clipboard_text` |
| template | `icon_-Tb_template` |

## Actions & editing

| Name | Class |
|---|---|
| actions_plus | `icon_-Bd_Actions_Plus` |
| circle_plus | `icon_-Tb_circle_plus` |
| circle-minus | `icon_-Tb_circle_minus` |
| click | `icon_-Tb_click` |
| clock_play | `icon_-Tb_clock_play` |
| copy | `icon_-Tb_copy` |
| copy-bold | `icon_-Bd_Copy` |
| cut | `icon_-Tb_cut` |
| delete | `icon_-Bd_Delete` |
| drag_drop | `icon_-Tb_drag_drop` |
| edit | `icon_-Tb_edit` |
| focus | `icon_-Tb_focus` |
| focus-2 | `icon_-Tb_focus_2` |
| hand_click | `icon_-Tb_hand_click` |
| hand_finger | `icon_-Tb_hand_finger` |
| hand_stop | `icon_-Tb_hand_stop` |
| minus | `icon_-Tb_minus` |
| minus-circle | `icon_-Bd_Minus_Circle` |
| paste | `icon_-Tb_copy` |
| pencil | `icon_-Tb_pencil` |
| play | `icon_-Bd_Play` |
| player_play | `icon_-Tb_player_play` |
| player_play_filled | `icon_-Tb_player_play_filled` |
| player_track_next | `icon_-Tb_player_track_next` |
| player-play | `icon_-Tb_player_play` |
| playlist | `icon_-Bd_Playlist` |
| playstation_x | `icon_-Tb_playstation_x` |
| plus | `icon_-Tb_plus` |
| plus-circle | `icon_-Bd_Plus_Circle` |
| pointer | `icon_-Tb_pointer` |
| refresh | `icon_-Tb_refresh` |
| repeat | `icon_-Tb_repeat` |
| repeat_once | `icon_-Tb_repeat_once` |
| replace | `icon_-Tb_replace` |
| save | `icon_-Tb_device_floppy` |
| select | `icon_-Tb_select` |
| select_all | `icon_-Tb_select_all` |
| selector | `icon_-Tb_selector` |
| status_change | `icon_-Tb_status_change` |
| text-plus | `icon_-Tb_text_plus` |
| trash | `icon_-Tb_trash` |
| trash-2 | `icon_-Tb_trash` |
| video_plus | `icon_-Tb_video_plus` |
| zoom_in | `icon_-Tb_zoom_in` |
| zoom_out | `icon_-Tb_zoom_out` |

## Status & alerts

| Name | Class |
|---|---|
| alert-circle | `icon_-Tb_alert_circle` |
| alert-circle-filled | `icon_-Tb_alert_circle_filled` |
| alert-triangle | `icon_-Tb_alert_triangle` |
| alert-triangle-filled | `icon_-Tb_alert_triangle_filled` |
| ban | `icon_-Tb_ban` |
| bell | `icon_-Tb_bell` |
| bell_ringing_2 | `icon_-Tb_bell_ringing_2` |
| brightness | `icon_-Tb_brightness` |
| check | `icon_-Tb_check` |
| check-circle | `icon_-Tb_circle_check` |
| checkbox | `icon_-Tb_checkbox` |
| checks | `icon_-Tb_checks` |
| circle_actions_alert_info | `icon_-Bd_Circle_Actions_Alert_Info` |
| circle_actions_close | `icon_-Bd_Circle_Actions_Close` |
| circle_actions_placeholder | `icon_-Bd_Circle_Actions_Placeholder` |
| circle-check | `icon_-Tb_circle_check` |
| circle-check-filled | `icon_-Tb_circle_check_filled` |
| clock_check | `icon_-Tb_clock_check` |
| exclamation-circle | `icon_-Tb_exclamation_circle` |
| filled_alert_info | `icon_-Bd_Filled_Alert_info` |
| filled_close | `icon_-Bd_Filled_Close` |
| filled_settings | `icon_-Bd_Filled_Settings` |
| filled_success | `icon_-Bd_Filled_Success` |
| info | `icon_-Tb_info_circle` |
| list_check | `icon_-Tb_list_check` |
| notification_bell | `icon_-Bd_Notification_Bell` |
| shield-check | `icon_-Tb_shield_check` |
| x-circle | `icon_-Tb_circle_x` |

## Communication

| Name | Class |
|---|---|
| email | `icon_-Tb_at` |
| inbox | `icon_-Bd_Inbox` |
| inbox1 | `icon_-Tb_inbox1` |
| mail | `icon_-Tb_mail` |
| mail_bold | `icon_-Bd_Mail` |
| message-reply | `icon_-Tb_message_reply_1` |
| microphone | `icon_-Tb_microphone` |
| phone | `icon_-Tb_phone` |
| reply | `icon_-Tb_message_reply_1` |
| send | `icon_-Tb_send` |
| share | `icon_-Tb_share` |

## Time & schedule

| Name | Class |
|---|---|
| alarm | `icon_-Tb_alarm` |
| calendar | `icon_-Tb_calendar` |
| calendar-event | `icon_-Tb_calendar_event` |
| calendar-month | `icon_-Tb_calendar_month` |
| calendar-time | `icon_-Tb_calendar_time` |
| calendar-week | `icon_-Tb_calendar_week` |
| clock | `icon_-Tb_clock` |
| clock_x | `icon_-Tb_clock_x` |
| history-toggle | `icon_-Tb_history_toggle` |
| hourglass_high | `icon_-Tb_hourglass_high` |

## Search & filter

| Name | Class |
|---|---|
| adjustments_horizontal | `icon_-Tb_adjustments_horizontal` |
| adjustments-horizontal | `icon_-Tb_adjustments_horizontal` |
| eye | `icon_-Tb_eye` |
| eye-off | `icon_-Tb_eye_off` |
| filter | `icon_-Tb_filter` |
| search | `icon_-Tb_search` |
| target | `icon_-Tb_target` |

## Security & keys

| Name | Class |
|---|---|
| blockquote | `icon_-Tb_blockquote` |
| key | `icon_-Tb_key` |
| keyboard | `icon_-Bd_Keyboard` |
| keyboard_show | `icon_-Tb_keyboard_show` |
| lock | `icon_-Tb_lock` |
| rubber-stamp | `icon_-Tb_rubber_stamp` |
| shield-lock | `icon_-Tb_shield_lock` |
| signature | `icon_-Tb_signature` |

## System & tech

| Name | Class |
|---|---|
| bot | `icon_-Bd_bot` |
| bug | `icon_-Tb_bug` |
| cloud_download | `icon_-Tb_cloud_download` |
| cloud_upload | `icon_-Tb_cloud_upload` |
| cloud-data-connection | `icon_-Tb_cloud_data_connection` |
| code | `icon_-Tb_code` |
| code-dots | `icon_-Tb_code_dots` |
| command | `icon_-Tb_command` |
| device_desktop | `icon_-Tb_device_desktop` |
| device_floppy | `icon_-Tb_device_floppy` |
| git_branch | `icon_-Tb_git_branch` |
| git-commit | `icon_-Tb_git_commit` |
| moon | `icon_-Tb_moon` |
| pipeline | `icon_-Tb_pipeline` |
| plug-connected | `icon_-Tb_plug_connected` |
| plug-disconnected | `icon_-Tb_plug_disconnected` |
| plug-disconnected-1 | `icon_-Tb_plug_disconnected_1` |
| route | `icon_-Tb_route` |
| server | `icon_-Tb_server` |
| sun | `icon_-Tb_sun` |
| terminal | `icon_-Tb_terminal` |
| tool | `icon_-Tb_tool` |
| webhook | `icon_-Tb_webhook` |
| wifi | `icon_-Tb_wifi` |
| world | `icon_-Tb_world` |

## Misc

| Name | Class |
|---|---|
| 3d-cube-sphere | `icon_-Tb_3d_cube_sphere` |
| a-b | `icon_-Tb_a_b` |
| ad-2 | `icon_-Tb_ad_2` |
| affiliate | `icon_-Tb_affiliate` |
| ai-agent | `icon_-Tb_ai_agent` |
| align-left | `icon_-Tb_align_left` |
| analyze | `icon_-Tb_analyze` |
| anchor | `icon_-Tb_anchor` |
| anchor-off | `icon_-Tb_anchor_off` |
| baseline-density-large | `icon_-Tb_baseline_density_large` |
| baseline-density-medium | `icon_-Tb_baseline_density_medium` |
| baseline-density-small | `icon_-Tb_baseline_density_small` |
| book | `icon_-Tb_book` |
| book-open | `icon_-Tb_book` |
| bookmark | `icon_-Tb_bookmark` |
| box | `icon_-Tb_box` |
| braces | `icon_-Tb_braces` |
| brackets-contain | `icon_-Tb_brackets_contain` |
| brand-speedtest | `icon_-Tb_brand_speedtest` |
| building-office | `icon_-Bd_Building_Business_Office` |
| building-skyscraper | `icon_-Tb_building_skyscraper` |
| bulb | `icon_-Tb_bulb` |
| bullets | `icon_-Bd_Bullets` |
| circle | `icon_-Tb_circle` |
| circle-dashed | `icon_-Tb_circle_dashed` |
| circle-dot | `icon_-Tb_circle_dot` |
| circles-relation | `icon_-Tb_circles_relation` |
| close_x | `icon_-Bd_Close_X` |
| cube | `icon_-Tb_cube` |
| decimal | `icon_-Tb_decimal` |
| dots | `icon_-Tb_dots` |
| dots-vertical | `icon_-Tb_dots_vertical` |
| download | `icon_-Tb_download` |
| export-bold | `icon_-Bd_Export` |
| external-link | `icon_-Tb_external_link` |
| flag | `icon_-Tb_flag` |
| flag-3 | `icon_-Tb_flag_3` |
| forms | `icon_-Tb_forms` |
| grip-vertical | `icon_-Tb_grip_vertical` |
| help | `icon_-Tb_help` |
| help-circle | `icon_-Tb_help_circle` |
| indent-increase | `icon_-Tb_indent_increase` |
| input-ai | `icon_-Tb_input_ai` |
| iterate_range | `icon_-Tb_Iterate_range` |
| jump_rope | `icon_-Tb_jump_rope` |
| layers_subtract | `icon_-Tb_layers_subtract` |
| layers-linked | `icon_-Tb_layers_linked` |
| line | `icon_-Tb_line` |
| line-dashed | `icon_-Tb_line_dashed` |
| line-dotted | `icon_-Tb_line_dotted` |
| link | `icon_-Tb_link` |
| link-2 | `icon_-Tb_link` |
| link-aggregate | `icon_-Tb_Link_Aggregate` |
| link-bold | `icon_-Bd_Link` |
| link-composition | `icon_-Tb_Link_Composition` |
| list | `icon_-Bd_Feed_List` |
| list-enum | `icon_-Tb_list` |
| list-numbers | `icon_-Tb_list_numbers` |
| loader | `icon_-Tb_loader` |
| log-out | `icon_-Tb_logout` |
| logout | `icon_-Tb_logout` |
| map-pin | `icon_-Tb_map_pin` |
| marquee-off | `icon_-Tb_marquee_off` |
| more-horizontal | `icon_-Tb_dots` |
| more-vertical | `icon_-Tb_dots_vertical` |
| number | `icon_-Tb_number` |
| package | `icon_-Tb_package` |
| palette | `icon_-Tb_palette` |
| pennant | `icon_-Tb_pennant` |
| pin | `icon_-Tb_pinned` |
| pin-off | `icon_-Tb_pin` |
| question-mark | `icon_-Tb_question_mark` |
| quote-left | `icon_-Bd_Quote_Left` |
| quote-right | `icon_-Tb_quote` |
| reconciliation | `icon_-Tb_reconciliation` |
| relation-one-to-many | `icon_-Tb_relation_one_to_many` |
| rocket | `icon_-Tb_rocket` |
| settings | `icon_-Tb_settings` |
| settings-bold | `icon_-Bd_Settings` |
| settings-line | `icon_-Ax_settings` |
| shopping-cart | `icon_-Tb_shopping_cart` |
| slashes | `icon_-Tb_slashes` |
| social | `icon_-Tb_social` |
| sparkles | `icon_-Tb_sparkles` |
| spinner | `icon_-Tb_loader` |
| spinner_line | `icon_-Tb_spinner_line` |
| star | `icon_-Tb_star` |
| subtask | `icon_-Tb_subtask` |
| toggle-left | `icon_-Tb_toggle_left` |
| toggle-right | `icon_-Tb_toggle_right` |
| tutorials | `icon_-Tb_book` |
| tutorials-bold | `icon_-Bd_Read_Book` |
| unlink | `icon_-Tb_unlink` |
| upload | `icon_-Tb_upload` |
| video | `icon_-Tb_video` |
| x | `icon_-Tb_x` |
