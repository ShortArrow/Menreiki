use serde::{Deserialize, Serialize};

/// Axis-aligned rectangle in page-image pixel coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl Rect {
    /// Smallest rectangle covering both `self` and `other`.
    pub fn union(&self, other: &Rect) -> Rect {
        let x = self.x.min(other.x);
        let y = self.y.min(other.y);
        let right = (self.x + self.width).max(other.x + other.width);
        let bottom = (self.y + self.height).max(other.y + other.height);
        Rect {
            x,
            y,
            width: right - x,
            height: bottom - y,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn union_covers_both_rectangles() {
        let a = Rect {
            x: 10.0,
            y: 20.0,
            width: 30.0,
            height: 10.0,
        };
        let b = Rect {
            x: 50.0,
            y: 15.0,
            width: 20.0,
            height: 10.0,
        };

        let union = a.union(&b);

        assert_eq!(
            union,
            Rect {
                x: 10.0,
                y: 15.0,
                width: 60.0,
                height: 15.0,
            }
        );
    }
}
