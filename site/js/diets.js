/* Diet compatibility rules. Pure logic, no DOM access.
   These are conservative screening rules for home cooking, not medical advice:
   a recipe that passes still needs the ingredient labels checked by the cook. */
(function () {
  "use strict";

  const CMF = window.CMF;

  CMF.DIETS = [
    {
      key: "gluten_free",
      label: "无麸质",
      emoji: "🌾",
      desc: "避开小麦面制品与含麸质调味料",
    },
    {
      key: "keto",
      label: "生酮 / 低碳水",
      emoji: "🥑",
      desc: "每份碳水 ≤ 20 g，且不含主食与添加糖",
    },
    {
      key: "vegan",
      label: "纯素",
      emoji: "🌱",
      desc: "不含肉、蛋、奶、水产与蜂蜜",
    },
  ];

  CMF.DIET_KEYS = CMF.DIETS.map((d) => d.key);
  CMF.KETO_CARB_LIMIT = 20;

  // Condiments that commonly contain wheat even though their own allergen
  // field is empty. Deliberately conservative: false negatives are worse than
  // hiding a few extra recipes.
  const GLUTEN_CONDIMENTS = new Set([
    "生抽", "老抽", "酱油", "蒸鱼豉油", "蚝油", "豆瓣酱", "黄豆酱",
    "甜面酱", "辣椒酱", "咖喱块", "火锅底料", "味噌",
  ]);

  // Staples and sugars that are incompatible with keto regardless of the
  // (coarse) gram estimate.
  const HIGH_CARB = new Set([
    "大米", "米饭", "小米", "糯米", "燕麦", "面粉", "面条", "挂面",
    "方便面", "荞麦面", "乌冬面", "意面", "米粉", "粉丝", "粉条",
    "馒头", "面包糠", "糯米粉", "藕粉", "面包", "吐司", "饺子", "馄饨",
    "包子", "藜麦", "土豆", "红薯", "山药", "莲藕", "玉米", "豌豆",
    "菱角", "荸荠", "百合", "汤圆", "速冻饺子", "速冻包子", "手抓饼",
    "冻薯条", "冻玉米粒", "白糖", "冰糖", "蜂蜜", "可乐", "红枣",
    "枸杞", "淀粉",
  ]);

  const ANIMAL_CATEGORIES = new Set(["肉蛋", "水产"]);
  const ANIMAL_EXTRA = new Set([
    "牛奶", "酸奶", "奶酪", "黄油", "奶油", "蜂蜜", "高汤",
    "鸡精", "虾皮", "蟹棒", "虾滑", "腐乳",
  ]);
  const ANIMAL_ALLERGENS = new Set(["鸡蛋", "牛奶", "鱼", "甲壳类"]);

  function ingredientsOf(recipe) {
    return (recipe.ingredients || []).filter((i) => !i.optional);
  }

  function allergenInfo(canonical) {
    if (typeof CMF.allergensOf === "function") return CMF.allergensOf(canonical) || [];
    const entry = typeof CMF.entry === "function" ? CMF.entry(canonical) : null;
    return (entry && entry.allergens) || [];
  }

  function categoryInfo(canonical) {
    const entry = typeof CMF.entry === "function" ? CMF.entry(canonical) : null;
    return (entry && entry.category) || "";
  }

  /* Returns the offending ingredient names. Empty array => compatible. */
  CMF.dietConflicts = function (recipe, key) {
    if (!recipe) return ["<无菜谱>"];
    const lines = ingredientsOf(recipe);
    const names = lines.map((i) => i.canonical);
    if (key === "gluten_free") {
      if ((recipe.allergens || []).includes("麸质")) return ["菜谱标注含麸质"];
      return names.filter((n) =>
        GLUTEN_CONDIMENTS.has(n) || allergenInfo(n).includes("麸质")
      );
    }
    if (key === "keto") {
      const offenders = names.filter((n) => HIGH_CARB.has(n));
      const carbs = typeof CMF.carbsPerServing === "function"
        ? CMF.carbsPerServing(recipe)
        : Infinity;
      if (!Number.isFinite(carbs) || carbs > CMF.KETO_CARB_LIMIT) {
        offenders.push("每份碳水超过 " + CMF.KETO_CARB_LIMIT + " g");
      }
      return offenders;
    }
    if (key === "vegan") {
      if ((recipe.allergens || []).some((a) => ANIMAL_ALLERGENS.has(a))) {
        return ["菜谱标注含动物性过敏原"];
      }
      return names.filter(
        (n) =>
          ANIMAL_CATEGORIES.has(categoryInfo(n)) ||
          ANIMAL_EXTRA.has(n) ||
          allergenInfo(n).some((a) => ANIMAL_ALLERGENS.has(a))
      );
    }
    return ["未知饮食偏好"];
  };

  CMF.matchesDiet = function (recipe, key) {
    return CMF.dietConflicts(recipe, key).length === 0;
  };

  CMF.matchesDiets = function (recipe, diets) {
    return (diets || []).every((key) => CMF.matchesDiet(recipe, key));
  };

  CMF.compatibleDiets = function (recipe) {
    return CMF.DIET_KEYS.filter((key) => CMF.matchesDiet(recipe, key));
  };

  CMF.dietLabel = function (key) {
    const found = CMF.DIETS.find((d) => d.key === key);
    return found ? found.label : key;
  };
})();
