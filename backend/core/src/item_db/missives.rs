use serde_json::Value;

pub fn list_missives() -> Vec<Value> {
    super::crafting::list_current_missives()
}
